"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const CDN = new Set(["pbs.twimg.com", "video.twimg.com"]);
const TYPES = new Map([
  ["image/jpeg", ["jpg", b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff]],
  ["image/png", ["png", b => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))]],
  ["image/gif", ["gif", b => /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))]],
  ["image/webp", ["webp", b => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"]],
  ["video/mp4", ["mp4", b => b.toString("ascii", 4, 8) === "ftyp"]],
]);
const MAX_FILE = 64 * 1024 * 1024;
const MAX_POST = 192 * 1024 * 1024;
const MAX_FILES = 48;

function safeHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) {
      url.hash = "";
      return url.href;
    }
  } catch {}
  return "";
}

function isCdnUrl(value) {
  return !!value && CDN.has(new URL(value).hostname);
}

async function download(source, limit, timeRemaining) {
  let url = source;
  const signal = AbortSignal.timeout(Math.min(20000, timeRemaining));
  for (let hops = 0; hops <= 3; hops++) {
    if (!isCdnUrl(url)) throw new Error("not an X media CDN URL");
    const response = await fetch(url, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const target = response.headers.get("location");
      if (!target) throw new Error("redirect missing destination");
      url = safeHttps(new URL(target, url));
      continue;
    }
    const kind = TYPES.get(response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase());
    if (!response.ok || !kind || !response.body || Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error("unavailable, unsupported, or too large");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > limit) throw new Error("media exceeds size limit");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, size);
    if (!kind[1](bytes)) throw new Error("media does not match its declared file type");
    return { bytes, extension: kind[0] };
  }
  throw new Error("too many media redirects");
}

async function archiveMedia(vault, id, items) {
  if (!/^\d+$/.test(id)) throw new Error("Invalid media archive ID.");
  const relativeDir = path.posix.join("X", "Attachments", id);
  const unique = new Map();
  for (const item of items) {
    if (!unique.has(item.url)) unique.set(item.url, item);
  }
  const saved = new Map();
  const deadline = Date.now() + 60000;
  let bytes = 0;
  if (!unique.size) return { saved, unavailable: 0 };
  async function archiveOne(item) {
    if (!isCdnUrl(item.url) || item.linkOnly) return;
    const fingerprint = createHash("sha256").update(item.url).digest("hex").slice(0, 24);
    try {
      // Reject symlinked vault output directories, even if the user already has an X folder.
      let dir = vault;
      for (const part of relativeDir.split("/")) {
        dir = path.join(dir, part);
        try { fs.mkdirSync(dir); } catch (error) { if (error.code !== "EEXIST") throw error; }
        if (!fs.lstatSync(dir).isDirectory()) throw new Error("attachment directory is not a real directory");
      }
      const cached = [...TYPES.values()].map(([ext]) => `${fingerprint}.${ext}`).find(name => {
        try {
          const stat = fs.lstatSync(path.join(dir, name));
          return stat.isFile() && stat.size > 0;
        } catch { return false; }
      });
      if (cached) {
        saved.set(item.url, path.posix.join(relativeDir, cached));
        return;
      }
      const timeRemaining = deadline - Date.now();
      if (bytes >= MAX_POST || timeRemaining <= 0) return;
      const limit = Math.min(MAX_FILE, MAX_POST - bytes);
      const fallback = item.fallback && item.fallback !== item.url ? item.fallback : "";
      const { bytes: data, extension } = await download(item.url, limit, fallback ? Math.min(timeRemaining, 12000) : timeRemaining)
        .catch(error => {
          const remaining = deadline - Date.now();
          if (!fallback || remaining <= 0) throw error;
          return download(fallback, limit, remaining);
        });
      const name = `${fingerprint}.${extension}`;
      if (bytes + data.length > MAX_POST) return;
      fs.writeFileSync(path.join(dir, name), data, { flag: "wx" });
      bytes += data.length;
      saved.set(item.url, path.posix.join(relativeDir, name));
    } catch (error) {
      console.warn(`X attachment not archived: ${error.message}`);
    }
  }
  const queue = [...unique.values()];
  for (let i = 0; i < queue.length && saved.size < MAX_FILES;) {
    const batch = queue.slice(i, i + Math.min(3, MAX_FILES - saved.size));
    await Promise.all(batch.map(archiveOne));
    i += batch.length;
  }
  return { saved, unavailable: unique.size - saved.size };
}

function mediaReference(item, archived) {
  const local = archived?.get(item.url);
  if (local) return `![[${local}]]`;
  return `[Media source (not archived)](<${item.url}>)`;
}

module.exports = { safeHttps, archiveMedia, mediaReference };
