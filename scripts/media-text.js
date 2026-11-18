"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const run = require("node:util").promisify(execFile);

const MAX_VIDEO_SECONDS = 30 * 60;
const commandPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH || "").split(path.delimiter).filter(Boolean)];

function findExecutable(candidates) {
  return candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function runTool(tool, args, timeout) {
  return run(tool, args, { timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });
}

function unavailable(file, kind, reason) {
  return { file, kind, status: "unavailable", reason };
}

async function readImages(vault, files) {
  if (!files.length) return [];
  const helper = findExecutable([
    path.join(__dirname, "XMediaOCR"),
    path.join(os.homedir(), "Applications", "X to Obsidian.app", "Contents", "Resources", "XMediaOCR"),
  ]);
  const source = path.join(__dirname, "..", "desktop", "media-ocr.swift");
  const compiler = process.platform === "darwin" && fs.existsSync(source) ? "/usr/bin/swift" : "";
  if (!helper && !compiler) return files.map(file => unavailable(file, "image", "Apple Vision OCR helper unavailable."));
  try {
    const { stdout } = await runTool(helper || compiler, [...(helper ? [] : [source]),
      ...files.map(file => path.resolve(vault, file))], 90000);
    const results = JSON.parse(stdout);
    return files.map((file, i) => {
      const result = results[i];
      if (!result || !["ok", "no_text"].includes(result.status)) return unavailable(file, "image", "Apple Vision could not read this image.");
      return { file, kind: "image", status: result.status, text: String(result.text || "") };
    });
  } catch {
    return files.map(file => unavailable(file, "image", "Apple Vision OCR could not finish."));
  }
}

function timestamp(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const pad = value => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function parseTranscript(report) {
  if (!Array.isArray(report?.transcription)) throw new Error("Invalid Whisper JSON.");
  return report.transcription.flatMap(segment => {
    const text = String(segment.text || "").trim().replace(/\s+/g, " ");
    if (!text || /^\s*[[(](?:music|blank.audio|silence|inaudible|applause)[\])]\s*$/i.test(text)) return [];
    return [{ at: timestamp(Number(segment.offsets?.from) || 0), text }];
  });
}

async function transcribeVideo(vault, file, deadline) {
  const find = name => findExecutable(commandPaths.map(dir => path.join(dir, name)));
  const ffprobe = find("ffprobe");
  const ffmpeg = find("ffmpeg");
  const whisper = find("whisper-cli");
  const model = process.env.X2OBSIDIAN_WHISPER_MODEL || path.join(os.homedir(), "Library", "Application Support",
    "X to Obsidian", "Models", "ggml-small-q5_1.bin");
  const fail = reason => unavailable(file, "video", reason);
  if (!ffprobe) return fail("FFmpeg tools are not installed.");
  const input = path.resolve(vault, file);
  let dir;
  try {
    const { stdout } = await runTool(ffprobe, ["-v", "error", "-protocol_whitelist", "file", "-f", "mov",
      "-select_streams", "a:0", "-show_entries", "stream=index:format=duration", "-of", "json", input], 15000);
    const info = JSON.parse(stdout);
    if (!info.streams?.length) return { file, kind: "video", status: "no_audio" };
    const duration = Number(info.format?.duration);
    if (!(duration > 0 && duration <= MAX_VIDEO_SECONDS)) return fail("Audio duration unknown or video exceeds 30 minutes.");
    if (!ffmpeg || !whisper || !fs.existsSync(model)) return fail("Install FFmpeg, whisper.cpp, and a local Whisper model.");
    if (deadline <= Date.now()) return fail("Local transcription time budget reached.");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2obsidian-transcript-"));
    const wav = path.join(dir, "speech.wav");
    const output = path.join(dir, "speech");
    await runTool(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file",
      "-f", "mov", "-i", input, "-map", "0:a:0", "-vn", "-t", String(MAX_VIDEO_SECONDS),
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], 60000);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail("Local transcription time budget reached.");
    await runTool(whisper, ["-m", model, "-f", wav, "-l", "auto", "-oj", "-of", output, "-np", "-sns"],
      Math.min(remaining, 300000));
    const segments = parseTranscript(JSON.parse(fs.readFileSync(output + ".json", "utf8")));
    return { file, kind: "video", status: segments.length ? "ok" : "no_speech", segments };
  } catch {
    return fail("Local speech recognition could not finish or the video could not be decoded.");
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function extractMediaText(vault, attachments) {
  const files = [...new Set(attachments)];
  const images = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
  const videos = files.filter(file => /\.mp4$/i.test(file));
  const deadline = Date.now() + 360000;
  const videoResults = (async () => {
    const results = [];
    for (const file of videos) results.push(await transcribeVideo(vault, file, deadline));
    return results;
  })();
  const [ocr, transcripts] = await Promise.all([readImages(vault, images), videoResults]);
  return [...ocr, ...transcripts];
}

module.exports = { extractMediaText, parseTranscript };
