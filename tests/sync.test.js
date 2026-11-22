"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const sync = require("../scripts/sync-x-to-obsidian.js");
const { capture } = require("../scripts/desktop-capture.js");
const { resolveVaultRoot, openSavedNote } = require("../scripts/obsidian-vault.js");
const { parseTranscript, mergeScreenFrames, parseSubtitles } = require("../scripts/media-text.js");

const URL = "https://x.com/example/status/1234567890";
const BODY = "Use small notes and connect related ideas. Keep an independent backup of your vault.";
const IMAGE = "https://pbs.twimg.com/media/example.png";
const VIDEO = "https://video.twimg.com/example.mp4";

function articleTweet(withBody = true) {
  return {
    text: "",
    raw_text: { text: "https://t.co/example" },
    author: { name: "Example Author", screen_name: "example" },
    created_at: "2026-06-12T12:00:00Z",
    article: {
      title: "A synthetic knowledge guide",
      preview_text: "A short preview.",
      content: { blocks: withBody ? [{ type: "unstyled", text: BODY }] : [] },
    },
  };
}

async function withVault(run) {
  const vault = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "x-to-obsidian-test-")));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  const originalFetch = global.fetch;
  const requests = [];
  let tweet = articleTweet();
  const extras = new Map();
  let summaryFailure = false;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith("https://publish.twitter.com/oembed")) {
      return new Response(JSON.stringify({
        author_name: "Example Author",
        html: '<p><a href="https://t.co/example">https://t.co/example</a></p><a>June 12, 2026</a>',
      }));
    }
    if (extras.has(String(url))) return extras.get(String(url))();
    if (String(url).startsWith("https://api.fxtwitter.com/")) {
      if (tweet === null) return new Response("Unavailable", { status: 503 });
      return new Response(JSON.stringify({ tweet }));
    }
    if (String(url) === "http://localhost:11434/api/chat") {
      if (summaryFailure) return new Response("Unavailable", { status: 503 });
      return new Response(JSON.stringify({ message: { content: "本地知识库摘要。\n\nLocal knowledge summary." } }));
    }
    throw new Error("Unexpected fetch URL in test");
  };
  try {
    await run({
      vault,
      requests,
      args: { vault, refresh: false, summarize: false, open: false, model: "test-model" },
      setTweet(value) { tweet = value; },
      respond(url, handler) { extras.set(url, handler); },
      failSummary() { summaryFailure = true; },
    });
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

test("captures an article body and deduplicates repeated URLs", async () => {
  await withVault(async ({ vault, args, requests }) => {
    const relative = await sync.syncOne(URL, args);
    const markdown = fs.readFileSync(path.join(vault, relative), "utf8");
    assert.ok(markdown.includes(BODY));
    assert.ok(markdown.includes('capture_status: "complete"'));
    const count = requests.length;
    await sync.syncOne(URL, args);
    assert.equal(requests.length, count, "duplicates should not fetch again");
    assert.equal(fs.readdirSync(path.join(vault, "X", "Tweets")).length, 1);
    const inbox = fs.readFileSync(path.join(vault, "X", "Inbox", "X Inbox.md"), "utf8");
    assert.equal((inbox.match(/\| @example \|/g) || []).length, 1);
  });
});

test("refresh preserves My Notes, original capture time, and a backup", async () => {
  await withVault(async ({ vault, args }) => {
    const relative = await sync.syncOne(URL, args);
    const file = path.join(vault, relative);
    const first = fs.readFileSync(file, "utf8");
    const edited = first.replace(/## My Notes[\s\S]*$/, "## My Notes\n\nMy own observation.\n");
    fs.writeFileSync(file, edited);
    await sync.syncOne(URL, { ...args, refresh: true });
    const refreshed = fs.readFileSync(file, "utf8");
    assert.ok(refreshed.includes("My own observation."));
    assert.equal(refreshed.match(/^captured_at:.*$/m)[0], first.match(/^captured_at:.*$/m)[0]);
    const backups = path.join(vault, "X", ".x-sync-backups");
    const entries = fs.readdirSync(backups);
    assert.equal(entries.length, 1);
    assert.equal(fs.readFileSync(path.join(backups, entries[0]), "utf8"), edited);
  });
});

test("preview-only article is incomplete and does not downgrade a full-text note", async () => {
  await withVault(async ({ vault, args, setTweet }) => {
    const relative = await sync.syncOne(URL, args);
    const file = path.join(vault, relative);
    const before = fs.readFileSync(file, "utf8");
    setTweet(articleTweet(false));
    await assert.rejects(sync.syncOne(URL, { ...args, refresh: true }), /existing full-text note was preserved/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });
  await withVault(async ({ vault, args, setTweet, requests }) => {
    setTweet(articleTweet(false));
    const relative = await sync.syncOne(URL, { ...args, summarize: true });
    const note = fs.readFileSync(path.join(vault, relative), "utf8");
    assert.ok(note.includes('capture_status: "incomplete"'));
    assert.deepEqual(sync.incompleteNoteUrls(vault), [URL]);
    assert.ok(!requests.some(r => r.url.includes("localhost")), "never summarize a preview as a full article");
  });
});

test("URL-only fallback is incomplete even when oEmbed succeeds", async () => {
  await withVault(async ({ vault, args, setTweet }) => {
    setTweet(null);
    const relative = await sync.syncOne(URL, args);
    const note = fs.readFileSync(path.join(vault, relative), "utf8");
    assert.ok(note.includes('capture_status: "incomplete"'));
    assert.deepEqual(sync.incompleteNoteUrls(vault), [URL]);
  });
});

test("summarization receives actual article text and appears before the body", async () => {
  await withVault(async ({ vault, args, requests }) => {
    const relative = await sync.syncOne(URL, { ...args, summarize: true });
    const request = requests.find(r => r.url === "http://localhost:11434/api/chat");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.model, "test-model");
    assert.ok(payload.messages[1].content.includes(BODY));
    const note = fs.readFileSync(path.join(vault, relative), "utf8");
    assert.ok(note.indexOf("## Local AI Summary") < note.indexOf("## X Article"));
  });
});

test("Ollama failure does not lose captured source text", async () => {
  await withVault(async ({ vault, args, failSummary }) => {
    failSummary();
    const relative = await sync.syncOne(URL, { ...args, summarize: true });
    const note = fs.readFileSync(path.join(vault, relative), "utf8");
    assert.ok(note.includes(BODY));
    assert.ok(!note.includes("## Local AI Summary"));
  });
});

test("CLI rejects missing argument values and nonexistent vaults", () => {
  assert.throws(() => sync.parseArgs(["node", "script", "--url"]), /requires a value/);
  assert.equal(sync.normalizeXUrl("https://twitter.com/example/status/1234567890/photo/1?s=20"), URL);
  const result = spawnSync(process.execPath, [
    path.join(__dirname, "../scripts/sync-x-to-obsidian.js"),
    "--vault", path.join(os.tmpdir(), `missing-vault-${process.pid}-${Date.now()}`), "--url", URL,
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Choose an existing Obsidian vault/);
});

test("article atomic entities use their DraftJS key rather than array position", () => {
  const markdown = sync.articleBlocksToMarkdown({
    blocks: [{ type: "atomic", text: " ", entityRanges: [{ key: 7, offset: 0, length: 1 }] }],
    entityMap: [
      { key: "7", value: { type: "MARKDOWN", data: { markdown: "```\nexample code\n```" } } },
      { key: "0", value: { type: "DIVIDER", data: {} } },
    ],
  });
  assert.equal(markdown, "```\nexample code\n```");
});

test("desktop saves directly in the selected subfolder but opens using the real vault", async () => {
  await withVault(async ({ vault, args }) => {
    const selected = path.join(vault, "UI repo", "Nested folder");
    fs.mkdirSync(selected, { recursive: true });
    const result = await capture({ ...args, url: URL, vault: selected, open: true });
    assert.equal(result.status, "saved");
    assert.equal(result.vault, vault);
    assert.equal(result.destination, selected);
    assert.equal(path.dirname(result.note), path.relative(vault, selected));
    assert.ok(fs.existsSync(path.join(vault, result.note)));
    assert.ok(!fs.existsSync(path.join(selected, "X")));
    assert.equal(result.opened, false, "a local vault folder not added to Obsidian must not raise a popup");
    assert.ok(result.openWarning);
  });
});

test("re-saving into a chosen folder moves an indexed note and keeps all text", async () => {
  await withVault(async ({ vault, args, requests }) => {
    const first = await capture({ ...args, url: URL, summarize: true });
    const oldPath = path.join(vault, first.note);
    fs.appendFileSync(oldPath, "\nA personal note.\n");
    const old = fs.readFileSync(oldPath, "utf8");
    const destination = path.join(vault, "AI agent");
    fs.mkdirSync(destination);
    const requestCount = requests.length;
    const moved = await capture({ ...args, vault: destination, url: URL, summarize: true });
    assert.equal(moved.note, path.join("AI agent", path.basename(first.note)));
    assert.equal(fs.readFileSync(path.join(vault, moved.note), "utf8"), old);
    assert.ok(!fs.existsSync(oldPath));
    assert.equal(requests.length, requestCount);
    const index = JSON.parse(fs.readFileSync(path.join(vault, "X", ".x-sync-index.json"), "utf8"));
    assert.equal(index.tweets["1234567890"].file, moved.note);
    const inbox = fs.readFileSync(path.join(vault, "X", "Inbox", "X Inbox.md"), "utf8");
    assert.ok(inbox.includes(`[[${moved.note.slice(0, -3)}]]`));
    assert.ok(!inbox.includes(first.note.slice(0, -3)));
    assert.equal((await capture({ ...args, url: URL })).note, moved.note, "root selection does not move an existing note");
  });
});

test("a destination collision leaves both existing notes untouched", async () => {
  await withVault(async ({ vault, args }) => {
    const first = await capture({ ...args, url: URL });
    const oldPath = path.join(vault, first.note);
    const old = fs.readFileSync(oldPath, "utf8");
    const destination = path.join(vault, "AI agent");
    fs.mkdirSync(destination);
    const occupied = path.join(destination, path.basename(first.note));
    fs.writeFileSync(occupied, "Do not overwrite.");
    await assert.rejects(capture({ ...args, vault: destination, url: URL }), /nothing was overwritten/);
    assert.equal(fs.readFileSync(oldPath, "utf8"), old);
    assert.equal(fs.readFileSync(occupied, "utf8"), "Do not overwrite.");
    assert.equal((await capture({ ...args, url: URL })).note, first.note);
  });
});

test("preview-only notes saved to a subfolder still appear in the refresh list", async () => {
  await withVault(async ({ vault, args, setTweet }) => {
    setTweet(articleTweet(false));
    const destination = path.join(vault, "AI agent");
    fs.mkdirSync(destination);
    const result = await capture({ ...args, vault: destination, url: URL });
    assert.equal(path.dirname(result.note), "AI agent");
    assert.deepEqual(sync.incompleteNoteUrls(vault), [URL]);
  });
});
test("resolver respects nested vault roots and rejects unrelated folders", async () => {
  await withVault(async ({ vault }) => {
    const nested = path.join(vault, "Nested vault");
    const child = path.join(nested, "Folder");
    fs.mkdirSync(child, { recursive: true });
    assert.equal(resolveVaultRoot(child, []), vault);
    assert.equal(resolveVaultRoot(child, [nested]), nested);
    fs.mkdirSync(path.join(nested, ".obsidian"));
    assert.equal(resolveVaultRoot(child, [vault]), nested);
    fs.rmSync(path.join(vault, ".obsidian"), { recursive: true });
    assert.throws(() => resolveVaultRoot(vault, []), /Choose an existing Obsidian vault/);
  });
});

test("opens an exact UTF-8 note path and reports launch failure without losing the note", async () => {
  await withVault(async ({ vault }) => {
    const filename = "X/Tweets/▫️Jubayer #1 & 100%.md";
    fs.mkdirSync(path.join(vault, "X", "Tweets"), { recursive: true });
    fs.writeFileSync(path.join(vault, filename), "saved post");
    const opts = { platform: "darwin", registered: [vault] };
    let sent;
    assert.deepEqual(openSavedNote(vault, filename, { ...opts, dispatch: uri => { sent = new globalThis.URL(uri); } }), { opened: true });
    assert.equal(sent.searchParams.get("path"), path.join(vault, filename));
    assert.equal(sent.searchParams.has("vault"), false);
    const failure = openSavedNote(vault, filename, { ...opts, dispatch: () => { throw new Error("open failed"); } });
    assert.equal(failure.opened, false);
    assert.match(failure.openWarning, /your note is saved/);
    assert.equal(fs.readFileSync(path.join(vault, filename), "utf8"), "saved post");
  });
});

test("desktop capture reports saved/incomplete state and repairs an incomplete note automatically", async () => {
  await withVault(async ({ vault, args, setTweet }) => {
    setTweet(articleTweet(false));
    const incomplete = await capture({ ...args, url: URL });
    assert.equal(incomplete.status, "incomplete");
    setTweet(articleTweet());
    const repaired = await capture({ ...args, url: URL });
    assert.equal(repaired.status, "saved");
    assert.equal(repaired.note, incomplete.note);
    assert.ok(fs.readFileSync(path.join(vault, repaired.note), "utf8").includes(BODY));
  });
});

test("desktop capture adds a requested summary to an existing saved note", async () => {
  await withVault(async ({ vault, args, requests }) => {
    await capture({ ...args, url: URL });
    const result = await capture({ ...args, url: URL, summarize: true });
    assert.equal(result.status, "saved");
    assert.equal(result.hasSummary, true);
    assert.ok(requests.some(r => r.url.includes("localhost:11434")));
  });
});

test("article images are placed inline, archived offline, and reused on refresh", async () => {
  await withVault(async ({ vault, args, requests, setTweet, respond }) => {
    const tweet = articleTweet();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=", "base64");
    const image = { media_id: "42", media_info: { original_img_url: IMAGE, alt_text: "A diagram" } };
    tweet.article.media_entities = [image];
    tweet.article.content.blocks.push({ type: "atomic", entityRanges: [{ key: 7 }] },
      { type: "unstyled", text: "After the diagram." });
    tweet.article.content.entityMap = [{ key: "7", value: { type: "MEDIA", data: { mediaItems: [{ mediaId: "42" }] } } }];
    setTweet(tweet);
    respond(IMAGE, () => new Response(png, { headers: { "content-type": "image/png" } }));
    const ocr = async (_, files) => files.map(file => ({ file, kind: "image", status: "ok", text: "Diagram text" }));
    const result = await capture({ ...args, url: URL }, ocr);
    const file = path.join(vault, result.note);
    const note = fs.readFileSync(file, "utf8");
    const match = note.match(/!\[\[(X\/Attachments\/1234567890\/[^\]]+\.png)\]\]/);
    assert.ok(match);
    assert.ok(note.indexOf(BODY) < match.index && match.index < note.indexOf("After the diagram."));
    assert.ok(note.includes("Alt text: A diagram"));
    assert.match(note, /## Image Text \(OCR\)[\s\S]*Diagram text/);
    assert.deepEqual(fs.readFileSync(path.join(vault, match[1])), png);
    assert.equal(result.attachmentCount, 1);
    assert.equal(result.attachmentMissing, 0);
    await capture({ ...args, url: URL, refresh: true }, ocr);
    assert.equal(requests.filter(r => r.url === IMAGE).length, 1);
    delete tweet.article.media_entities;
    const before = fs.readFileSync(file, "utf8");
    await assert.rejects(capture({ ...args, url: URL, refresh: true }, ocr), /less attached media/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });
});

test("saves only the target post and passes OCR and video text into Ollama", async () => {
  await withVault(async ({ vault, args, requests, setTweet, respond }) => {
    const root = {
      id: "1234567890", author: { name: "Example Author" }, replies: 5, replying_to_status: "31",
      media: { all: [{ type: "photo", url: IMAGE }], photos: [{ type: "photo", url: IMAGE }],
        videos: [{ type: "video", url: VIDEO, formats: [
          { url: VIDEO, container: "mp4", bitrate: 200000 },
          { url: VIDEO + "?quality=hd", container: "mp4", bitrate: 2176000 },
          { url: VIDEO + "?quality=4k", container: "mp4", bitrate: 25000000 },
        ] }] },
      quote: { id: "32", text: "Private fixture quote body.", media: { photos: [{ url: "https://pbs.twimg.com/media/quoted.jpg" }] } },
      raw_text: { text: "", facets: [{ type: "url", expanded_url: "https://example.org/linked" }] },
    };
    setTweet(root);
    respond(IMAGE, () => new Response(Buffer.from("89504e470d0a1a0a", "hex"), { headers: { "content-type": "image/png" } }));
    respond(VIDEO + "?quality=hd", () => new Response(null, { status: 503 }));
    respond(VIDEO, () => new Response(Buffer.from("00000018667479706d703432", "hex"), { headers: { "content-type": "video/mp4" } }));
    const analysis = async (_, files) => files.flatMap(file => file.endsWith(".mp4") ? [
      { file, kind: "video", status: "ok", segments: [{ at: "01:05", text: "The video explains calibration." }] },
      { file, kind: "screen", status: "partial", interval: 500, reason: "Missing frames.",
        segments: [{ at: "01:05.5-01:08", text: "Reference marker" }] },
      { file, kind: "captions", status: "ok", language: "eng",
        segments: [{ at: "01:05.25-01:08", text: "Caption track text." }] },
    ] : [{ file, kind: "image", status: "ok", text: "Calibrate the camera." }]);
    const result = await capture({ ...args, url: URL, summarize: true }, analysis);
    const note = fs.readFileSync(path.join(vault, result.note), "utf8");
    assert.equal(result.status, "saved");
    assert.equal(result.attachmentCount, 2);
    assert.equal(result.imageTextCount, 1);
    assert.equal(result.transcriptCount, 1);
    assert.equal(result.videoOcrCount, 1);
    assert.equal(result.subtitleCount, 1);
    assert.equal(result.mediaTextMissing, 1);
    assert.match(note, /## Video Transcripts[\s\S]*01:05[\s\S]*The video explains calibration\./);
    assert.doesNotMatch(note, /Quote body|Conversation Context/);
    assert.ok(!requests.some(r => /conversation|quoted.jpg/.test(r.url)));
    const prompt = JSON.parse(requests.find(r => r.url.endsWith("/api/chat")).options.body).messages[1].content;
    assert.match(prompt, /Calibrate the camera/);
    assert.match(prompt, /The video explains calibration/);
    assert.match(prompt, /Video on-screen OCR [^\n]*partial coverage[\s\S]*Reference marker/);
    assert.match(prompt, /Embedded video subtitles [^\n]*language eng[\s\S]*Caption track text/);
    assert.match(note, /https:\/\/example\.org\/linked/);
    assert.match(note, /## Video On-Screen Text \(OCR\)[\s\S]*Partial OCR:[\s\S]*01:05\.5-01:08[\s\S]*Reference marker/);
    assert.match(note, /## Video Subtitle Tracks[\s\S]*eng[\s\S]*Caption track text/);
    const filepath = path.join(vault, result.note);
    const v3 = note.replace(/^archive_version: 4$/m, "archive_version: 3")
      .replace(/^(?:videos_with_screen_text|subtitle_tracks_saved): \d+\n/gm, "")
      .replace(/## Video On-Screen Text[\s\S]*?(?=## Engagement|## Metadata)/, "");
    fs.writeFileSync(filepath, v3);
    const migrated = await capture({ ...args, url: URL }, analysis);
    assert.equal(migrated.archiveVersion, 4);
    assert.equal(migrated.videoOcrCount, 1);
    assert.equal(migrated.note, result.note);
  });
});

test("blocks off-CDN redirects, rejects mislabeled binaries, and keeps source links", async () => {
  await withVault(async ({ requests, args, setTweet, respond, vault }) => {
    const second = "https://pbs.twimg.com/media/second.png";
    setTweet({ text: BODY, media: { photos: [{ url: IMAGE }, { url: second }] } });
    respond(IMAGE, () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }));
    respond(second, () => new Response("not an image", { headers: { "content-type": "image/png" } }));
    const result = await capture({ ...args, url: URL });
    assert.equal(result.attachmentCount, 0);
    assert.equal(result.attachmentMissing, 2);
    assert.ok(!requests.some(request => request.url.startsWith("https://127.0.0.1")));
    assert.match(fs.readFileSync(path.join(vault, result.note), "utf8"), /Media source \(not archived\)/);
  });
});

test("first re-save removes legacy conversation, retains the backup and keeps My Notes", async () => {
  await withVault(async ({ vault, args }) => {
    const first = await capture({ ...args, url: URL });
    const filepath = path.join(vault, first.note);
    const old = fs.readFileSync(filepath, "utf8").replace(/^archive_version: 4\n/m, "archive_version: 2\ncontext_posts: 1\n")
      .replace("## Metadata", "## Conversation Context\n\nOld context\n\n![[X/Attachments/1234567890/" + "a".repeat(24) + ".mp4]]\n\n## Metadata")
      .replace(/## My Notes[\s\S]*$/, "## My Notes\n\nMy notes stay here.\n");
    fs.writeFileSync(filepath, old);
    const upgraded = await capture({ ...args, url: URL });
    assert.equal(upgraded.note, first.note);
    assert.equal(upgraded.archiveVersion, 4);
    const upgradedNote = fs.readFileSync(filepath, "utf8");
    assert.match(upgradedNote, /My notes stay here\./);
    assert.doesNotMatch(upgradedNote, /Old context|Conversation Context/);
    const backups = path.join(vault, "X", ".x-sync-backups");
    assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), "utf8"), old);
  });
});

test("Whisper output uses timestamped text and skips non-speech placeholders", () => {
  assert.deepEqual(parseTranscript({ transcription: [
    { offsets: { from: 250 }, text: " [BLANK_AUDIO] " },
    { offsets: { from: 65000 }, text: " Camera   calibration. " },
  ] }), [{ at: "01:05", text: "Camera calibration." }]);
  assert.throws(() => parseTranscript({}), /Invalid Whisper JSON/);
});

test("merges repeated lines while keeping changed numbers and text that reappears later", () => {
  const labels = ["Persistent title\nDistance 3.5", "Persistent title.\nDistance 35", "Persistent title",
    "Persistent title", "Persistent title", "Persistent title\nDistance 3.5"];
  const merged = mergeScreenFrames(labels.map((text, i) => ({ at: i * 500, text })), 500, 2750);
  assert.deepEqual(merged, [
    { at: "00:00-00:02.75", text: "Persistent title" },
    { at: "00:00-00:00.5", text: "Distance 3.5" },
    { at: "00:00.5-00:01", text: "Distance 35" },
    { at: "00:02.5-00:02.75", text: "Distance 3.5" },
  ]);
});

test("retains subtitle ranges, line text and punctuation", () => {
  const srt = "1\r\n00:00:01,500 --> 00:00:03,025\r\n<i>Say</i> hello.\r\nNext line.\r\n\r\n"
    + "2\r\n00:01:03,000 --> 00:01:04,100\r\n你好。";
  assert.deepEqual(parseSubtitles(srt), [
    { at: "00:01.5-00:03.025", text: "Say hello. Next line." },
    { at: "01:03-01:04.1", text: "你好。" },
  ]);
});

test("keeps the note when an extraction retries with less text", async () => {
  await withVault(async ({ vault, args, setTweet, respond }) => {
    setTweet({ text: BODY, media: { photos: [{ url: IMAGE }] } });
    respond(IMAGE, () => new Response(Buffer.from("89504e470d0a1a0a", "hex"), { headers: { "content-type": "image/png" } }));
    const good = async (_, files) => files.map(file => ({ file, kind: "image", status: "ok", text: "Existing OCR." }));
    const failed = async (_, files) => files.map(file => ({ file, kind: "image", status: "unavailable", reason: "fixture" }));
    const result = await capture({ ...args, url: URL }, good);
    const file = path.join(vault, result.note);
    const original = fs.readFileSync(file, "utf8");
    await assert.rejects(capture({ ...args, url: URL, refresh: true }, failed), /less extracted media text/);
    assert.equal(fs.readFileSync(file, "utf8"), original);
  });
});
