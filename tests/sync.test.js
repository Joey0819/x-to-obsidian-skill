"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const sync = require("../scripts/sync-x-to-obsidian.js");

const URL = "https://x.com/example/status/1234567890";
const BODY = "Use small notes and connect related ideas. Keep an independent backup of your vault.";

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
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "x-to-obsidian-test-"));
  const originalFetch = global.fetch;
  const requests = [];
  let tweet = articleTweet();
  let summaryFailure = false;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith("https://publish.twitter.com/oembed")) {
      return new Response(JSON.stringify({
        author_name: "Example Author",
        html: '<p><a href="https://t.co/example">https://t.co/example</a></p><a>June 12, 2026</a>',
      }));
    }
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
  assert.match(result.stderr, /Vault does not exist/);
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
