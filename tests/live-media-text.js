"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const resources = path.join(os.homedir(), "Applications", "X to Obsidian.app", "Contents", "Resources");
const { capture } = require(path.join(resources, "desktop-capture.js"));
const url = "https://x.com/fixture/status/1234567890123456789";
const photo = "https://pbs.twimg.com/media/test.png";
const video = "https://video.twimg.com/test.mp4";
const silentVideo = "https://video.twimg.com/silent.mp4";

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "x2obsidian-media-fixture-"));
  const originalFetch = global.fetch;
  try {
    const png = path.join(work, "image.png");
    const speech = path.join(work, "speech.aiff");
    const mp4 = path.join(work, "speech.mp4");
    const silent = path.join(work, "silent.mp4");
    const fixtureApp = path.join(work, "ocr-fixture");
    execFileSync("/usr/bin/xcrun", ["swiftc", path.join(__dirname, "native", "ocr-fixture.swift"), "-o", fixtureApp]);
    execFileSync(fixtureApp, [png]);
    const intro = path.join(work, "intro.png");
    const outro = path.join(work, "outro.png");
    const silentFrame = path.join(work, "silent.png");
    execFileSync(fixtureApp, [intro, "Field setup", "Keep the lens level"]);
    execFileSync(fixtureApp, [outro, "Field setup", "Mark the reference point"]);
    execFileSync(fixtureApp, [silentFrame, "Silent video label"]);
    const srt = path.join(work, "captions.srt");
    fs.writeFileSync(srt, "1\n00:00:00,200 --> 00:00:01,400\nSelectable caption only.\n");
    execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", speech,
      "Calibrate the camera before recording the experiment. Save the results in the research notebook."]);
    execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error",
      "-loop", "1", "-framerate", "10", "-t", "2", "-i", intro,
      "-loop", "1", "-framerate", "10", "-t", "12", "-i", outro,
      "-i", speech, "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-map", "2:a", "-shortest", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", mp4]);
    execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-loop", "1", "-framerate", "10", "-i", silentFrame,
      "-i", srt, "-t", "2", "-map", "0:v", "-map", "1:s", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264",
      "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", silent]);
    const fixture = { text: "Media-only details belong in the same note.", replies: 3,
      author: { name: "Local fixture" }, quote: { id: "32", text: "Do not import this quote." },
      media: { all: [{ type: "photo", url: photo }, { type: "video", url: video }, { type: "gif", url: silentVideo }] } };
    let prompt = "";
    const media = new Map([[photo, [png, "image/png"]], [video, [mp4, "video/mp4"]], [silentVideo, [silent, "video/mp4"]]]);
    global.fetch = async (url, options) => {
      if (url.startsWith("https://publish.twitter.com/oembed")) return Response.json({ html: "<p>Media fixture</p>" });
      if (url === "https://api.fxtwitter.com/fixture/status/1234567890123456789") return Response.json({ tweet: fixture });
      if (media.has(url)) {
        const [file, type] = media.get(url);
        return new Response(fs.readFileSync(file), { headers: { "content-type": type } });
      }
      if (url === "http://localhost:11434/api/chat") {
        prompt = JSON.parse(options.body).messages[1].content;
        return Response.json({ message: { content: "Summary prompt captured for verification." } });
      }
      assert.fail(`Unexpected request: ${url}`);
    };
    const result = await capture({ url, vault: work, summarize: true, model: "fixture" });
    const note = fs.readFileSync(path.join(work, result.note), "utf8");
    assert.equal(result.status, "saved");
    assert.equal(result.attachmentCount, 3);
    assert.equal(result.imageTextCount, 1);
    assert.equal(result.transcriptCount, 1);
    assert.equal(result.videoOcrCount, 2);
    assert.equal(result.subtitleCount, 1);
    assert.equal(result.mediaTextMissing, 0);
    assert.match(note, /## Image Text \(OCR\)[\s\S]*Camera calibration checklist[\s\S]*动物行为追踪实验/i);
    assert.match(note, /## Video Transcripts[\s\S]*Calibrate the camera before recording the experiment/i);
    assert.match(note, /No audio track\./);
    assert.match(note, /## Video On-Screen Text \(OCR\)[\s\S]*Keep the lens level[\s\S]*00:02[\s\S]*Mark the reference point/i);
    assert.equal((note.match(/Field setup/gi) || []).length, 1, "persistent screen text should not repeat");
    assert.match(note, /Silent video label/i);
    assert.match(note, /## Video Subtitle Tracks[\s\S]*Subtitle track 1 \(eng\)[\s\S]*00:00\.2-00:01\.4[\s\S]*Selectable caption only/i);
    assert.doesNotMatch(note, /Conversation Context|Do not import this quote/);
    assert.match(prompt, /Camera calibration checklist/i);
    assert.match(prompt, /Calibrate the camera before recording the experiment/i);
    assert.match(prompt, /Keep the lens level/);
    assert.match(prompt, /Selectable caption only/);
    console.log(JSON.stringify({ installedMediaPipeline: "passed", bilingualOcr: true,
      timestampedSpeech: true, changingScreenText: true, deduplicatedOverlay: true,
      silentVideoText: true, embeddedCaptions: true, allInSummaryPrompt: true }));
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
