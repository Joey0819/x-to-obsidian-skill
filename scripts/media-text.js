"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const run = require("node:util").promisify(execFile);

const MAX_VIDEO_SECONDS = 30 * 60;
const MAX_SCREEN_FRAMES = 1200;
const TEXT_SUBTITLE_CODECS = new Set(["mov_text", "subrip", "webvtt", "text", "ass", "ssa", "ttml"]);
const LOCAL_MP4 = ["-protocol_whitelist", "file", "-f", "mov"];
const commandPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH || "").split(path.delimiter).filter(Boolean)];
const findTool = name => findExecutable(commandPaths.map(dir => path.join(dir, name)));

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

function findOCR() {
  const helper = findExecutable([
    path.join(__dirname, "XMediaOCR"),
    path.join(os.homedir(), "Applications", "X to Obsidian.app", "Contents", "Resources", "XMediaOCR"),
  ]);
  const source = path.join(__dirname, "..", "desktop", "media-ocr.swift");
  if (helper) return [helper];
  if (process.platform === "darwin" && fs.existsSync(source)) return ["/usr/bin/swift", source];
  return [];
}

async function runOCR([tool, ...prefix], files, timeout) {
  const { stdout } = await runTool(tool, [...prefix, ...files], timeout);
  const results = JSON.parse(stdout);
  if (!Array.isArray(results) || results.length !== files.length) throw new Error("Invalid OCR response.");
  return results;
}

async function readImages(vault, files) {
  if (!files.length) return [];
  const helper = findOCR();
  if (!helper.length) return files.map(file => unavailable(file, "image", "Apple Vision OCR helper unavailable."));
  try {
    const results = await runOCR(helper, files.map(file => path.resolve(vault, file)), 90000);
    return files.map((file, i) => {
      const result = results[i];
      if (!result || !["ok", "no_text"].includes(result.status)) return unavailable(file, "image", "Apple Vision could not read this image.");
      return { file, kind: "image", status: result.status, text: String(result.text || "") };
    });
  } catch {
    return files.map(file => unavailable(file, "image", "Apple Vision OCR could not finish."));
  }
}

function timestamp(milliseconds, precise = false) {
  const value = Math.max(0, Math.round(milliseconds));
  const seconds = Math.floor(value / 1000);
  const pad = value => String(value).padStart(2, "0");
  const fraction = precise && value % 1000 ? `.${String(value % 1000).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}${fraction}`;
}

const timeRange = (start, end) => `${timestamp(start, true)}-${timestamp(end, true)}`;

function mergeScreenFrames(frames, interval, duration) {
  const active = new Map();
  const segments = [];
  for (const { at, text } of frames) {
    if (at >= duration) break;
    for (const [key, segment] of active) if (at - segment.last > interval * 2) active.delete(key);
    for (const line of String(text || "").split(/\r?\n/)) {
      const value = line.trim();
      const key = value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[.!?。！？]+$/, "");
      if (!key) continue;
      const segment = active.get(key);
      if (segment) segment.last = at;
      else {
        const next = { start: at, last: at, text: value };
        active.set(key, next);
        segments.push(next);
      }
    }
  }
  return segments.map(segment => ({
    at: timeRange(segment.start, Math.min(duration, segment.last + interval)),
    text: segment.text,
  }));
}

function parseSubtitles(srt) {
  const timing = /^(\d+):(\d+):(\d+),(\d{3}) --> (\d+):(\d+):(\d+),(\d{3})(?:\s|$)/;
  const toMs = ([h, m, s, ms]) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
  return String(srt).trim().split(/\r?\n[\t ]*\r?\n/).flatMap(cue => {
    const lines = cue.split(/\r?\n/);
    const line = lines.findIndex(value => timing.test(value));
    if (line < 0) return [];
    const times = lines[line].match(timing);
    const text = lines.slice(line + 1).join(" ").replace(/<\/?(?:b|i|u|s|font)(?:\s[^<>]*?)?>/gi, "").replace(/\s+/g, " ").trim();
    return text ? [{ at: timeRange(toMs(times.slice(1, 5)), toMs(times.slice(5, 9))), text }] : [];
  });
}

function parseTranscript(report) {
  if (!Array.isArray(report?.transcription)) throw new Error("Invalid Whisper JSON.");
  return report.transcription.flatMap(segment => {
    const text = String(segment.text || "").trim().replace(/\s+/g, " ");
    if (!text || /^\s*[[(](?:music|blank.audio|silence|inaudible|applause)[\])]\s*$/i.test(text)) return [];
    return [{ at: timestamp(Number(segment.offsets?.from) || 0), text }];
  });
}

async function transcribeVideo(file, input, info, ffmpeg, deadline) {
  const whisper = findTool("whisper-cli");
  const model = process.env.X2OBSIDIAN_WHISPER_MODEL || path.join(os.homedir(), "Library", "Application Support",
    "X to Obsidian", "Models", "ggml-small-q5_1.bin");
  const fail = reason => unavailable(file, "video", reason);
  if (!info.streams?.some(stream => stream.codec_type === "audio")) return { file, kind: "video", status: "no_audio" };
  let dir;
  try {
    const duration = Number(info.format?.duration);
    if (!(duration > 0 && duration <= MAX_VIDEO_SECONDS)) return fail("Audio duration unknown or video exceeds 30 minutes.");
    if (!ffmpeg || !whisper || !fs.existsSync(model)) return fail("Install FFmpeg, whisper.cpp, and a local Whisper model.");
    if (deadline <= Date.now()) return fail("Local transcription time budget reached.");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2obsidian-transcript-"));
    const wav = path.join(dir, "speech.wav");
    const output = path.join(dir, "speech");
    await runTool(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", ...LOCAL_MP4,
      "-i", input, "-map", "0:a:0", "-vn", "-t", String(MAX_VIDEO_SECONDS),
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

async function readVideoFrames(file, input, seconds, ffmpeg, deadline) {
  const fail = reason => unavailable(file, "screen", reason);
  if (!(seconds > 0 && seconds <= MAX_VIDEO_SECONDS)) return fail("Video duration unknown or exceeds 30 minutes.");
  const helper = findOCR();
  if (!helper.length) return fail("Apple Vision OCR helper unavailable.");
  if (!ffmpeg) return fail("FFmpeg tools are not installed.");
  if (deadline <= Date.now()) return fail("Local video OCR time budget reached.");
  const duration = Math.round(seconds * 1000);
  const interval = Math.max(1, Math.ceil(duration / (MAX_SCREEN_FRAMES * 500))) * 500;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2obsidian-video-ocr-"));
  try {
    let incomplete = false;
    try {
      await runTool(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", ...LOCAL_MP4, "-i", input,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-vf",
        `fps=1000/${interval}:start_time=0:eof_action=pass,scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease`,
        "-frames:v", String(MAX_SCREEN_FRAMES), "-start_number", "0", "-q:v", "3", path.join(dir, "frame-%05d.jpg")],
      Math.max(1, Math.min(deadline - Date.now(), 90000)));
    } catch { incomplete = true; }
    const names = fs.readdirSync(dir).filter(name => /^frame-\d{5}\.jpg$/.test(name)).sort();
    const frames = [];
    let recognized = 0;
    for (let i = 0; i < names.length; i += 48) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { incomplete = true; break; }
      const batch = names.slice(i, i + 48);
      try {
        const results = await runOCR(helper, batch.map(name => path.join(dir, name)), Math.min(remaining, 60000));
        for (const [index, result] of results.entries()) {
          if (result.status === "ok" || result.status === "no_text") {
            frames.push({ at: Number(batch[index].slice(6, 11)) * interval, text: result.text });
            recognized += 1;
          } else incomplete = true;
        }
      } catch { incomplete = true; break; }
    }
    if (!recognized) return fail("No video frames could be sampled and read locally.");
    const segments = mergeScreenFrames(frames, interval, duration);
    return { file, kind: "screen", status: incomplete ? "partial" : segments.length ? "ok" : "no_text",
      segments, interval, recognized, ...(incomplete && { reason: "Some frames could not be read or the local time limit was reached." }) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function readSubtitleTracks(file, input, streams, seconds, ffmpeg, deadline) {
  const tracks = streams.filter(stream => stream.codec_type === "subtitle");
  const results = [];
  for (const stream of tracks.slice(0, 8)) {
    const track = stream.index;
    const language = /^[a-z0-9-]{1,12}$/i.test(stream.tags?.language) ? stream.tags.language : "";
    const fail = reason => ({ ...unavailable(file, "captions", reason), track, language });
    const remaining = deadline - Date.now();
    if (!ffmpeg || remaining <= 0 || !(seconds > 0 && seconds <= MAX_VIDEO_SECONDS) || !TEXT_SUBTITLE_CODECS.has(stream.codec_name)) {
      results.push(fail("Text subtitle track could not be extracted locally."));
      continue;
    }
    try {
      const { stdout } = await runTool(ffmpeg, ["-nostdin", "-loglevel", "error", ...LOCAL_MP4,
        "-i", input, "-map", `0:${track}`, "-t", String(MAX_VIDEO_SECONDS), "-c:s", "srt", "-f", "srt", "pipe:1"], Math.min(remaining, 15000));
      const segments = parseSubtitles(stdout);
      results.push({ file, kind: "captions", track, language, status: segments.length ? "ok" : "no_text", segments });
    } catch { results.push(fail("FFmpeg could not read the embedded subtitle track.")); }
  }
  if (tracks.length > 8) results.push(unavailable(file, "captions", "Only the first eight subtitle tracks were examined."));
  return results;
}

async function analyzeVideo(vault, file, deadline) {
  const ffprobe = findTool("ffprobe"), ffmpeg = findTool("ffmpeg");
  const fail = reason => ["video", "screen"].map(kind => unavailable(file, kind, reason));
  if (!ffprobe) return fail("FFmpeg tools are not installed.");
  const input = path.resolve(vault, file);
  let info;
  try {
    const { stdout } = await runTool(ffprobe, ["-v", "error", ...LOCAL_MP4, "-show_entries",
      "stream=index,codec_type,codec_name,duration:stream_tags=language:format=duration", "-of", "json", input], 15000);
    info = JSON.parse(stdout);
  } catch { return fail("The downloaded video could not be read."); }
  const streams = info.streams || [];
  const duration = Number(streams.find(stream => stream.codec_type === "video")?.duration ?? info.format?.duration);
  const [speech, screen, subtitles] = await Promise.all([
    transcribeVideo(file, input, info, ffmpeg, deadline),
    readVideoFrames(file, input, duration, ffmpeg, deadline).catch(() => unavailable(file, "screen", "Could not prepare local video OCR.")),
    readSubtitleTracks(file, input, streams, duration, ffmpeg, deadline).catch(() =>
      [unavailable(file, "captions", "Embedded subtitle tracks could not be read locally.")]),
  ]);
  return [speech, screen, ...subtitles];
}

async function extractMediaText(vault, attachments) {
  const files = [...new Set(attachments)];
  const images = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
  const videos = files.filter(file => /\.mp4$/i.test(file));
  const deadline = Date.now() + 360000;
  const videoResults = (async () => {
    const results = [];
    for (const file of videos) results.push(...await analyzeVideo(vault, file, deadline));
    return results;
  })();
  const [ocr, transcripts] = await Promise.all([readImages(vault, images), videoResults]);
  return [...ocr, ...transcripts];
}

module.exports = { extractMediaText, parseTranscript, mergeScreenFrames, parseSubtitles };
