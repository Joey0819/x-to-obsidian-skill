#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, syncOne, normalizeXUrl, existingContentStatus, currentXUrlsFromChrome } = require("./sync-x-to-obsidian.js");

async function capture(args) {
  const vault = path.resolve(args.vault);
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    throw new Error("Choose an existing Obsidian vault / 请选择已有 Obsidian 仓库。");
  }
  let url = args.url;
  if (!url && args.current) {
    const tabs = currentXUrlsFromChrome();
    if (tabs.length !== 1) throw new Error("Open one specific X post in Chrome, or paste its link / 请打开具体帖子，或粘贴帖子链接。");
    url = tabs[0].url;
  }
  if (!url) throw new Error("A post link is required / 需要具体帖子链接。");
  url = normalizeXUrl(url);
  const id = url.match(/\/status\/(\d+)$/)[1];
  const indexPath = path.join(vault, "X", ".x-sync-index.json");
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : { tweets: {} };
  const entry = index.tweets?.[id];
  let refresh = args.refresh;
  if (entry?.file && fs.existsSync(path.join(vault, entry.file))) {
    const oldNote = fs.readFileSync(path.join(vault, entry.file), "utf8");
    refresh ||= existingContentStatus(oldNote) === "incomplete" || (args.summarize && !oldNote.includes("## Local AI Summary"));
  }
  const relative = await syncOne(url, { ...args, vault, url, refresh });
  const note = fs.readFileSync(path.join(vault, relative), "utf8");
  return {
    status: existingContentStatus(note) === "complete" ? "saved" : "incomplete",
    note: relative,
    hasSummary: note.includes("## Local AI Summary"),
    opened: Boolean(args.open),
    vault,
  };
}

// GUI callers consume the final structured line; normal importer diagnostics stay readable.
if (require.main === module) {
  Promise.resolve().then(() => capture(parseArgs(process.argv))).then(result => {
    console.log(`X2OBSIDIAN_RESULT=${JSON.stringify(result)}`);
  }).catch(error => {
    console.log(`X2OBSIDIAN_RESULT=${JSON.stringify({ status: "error", message: error.message })}`);
    process.exitCode = 1;
  });
}

module.exports = { capture };
