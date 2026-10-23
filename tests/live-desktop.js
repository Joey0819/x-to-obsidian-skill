"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Pass a public X post URL for this optional network integration check.");
  if (spawnSync("/usr/bin/pgrep", ["-x", "XToObsidian"]).status === 0) throw new Error("Close X to Obsidian before the isolated integration check.");
  const app = path.join(os.homedir(), "Applications", "X to Obsidian.app");
  const handler = execFileSync("/usr/bin/xcrun", ["swift", path.join(__dirname, "native", "check-handler.swift")], { encoding: "utf8" }).trim();
  assert.equal(handler, app, "The installed app must be the registered URL handler before testing");
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "x2obsidian-desktop-"));
  const resultFile = path.join(os.homedir(), "Library", "Logs", "X to Obsidian", "last-result.json");
  const oldResult = fs.existsSync(resultFile) ? fs.readFileSync(resultFile) : null;
  let launched = false;
  try {
    execFileSync("/usr/bin/open", ["-a", app, "--env", `X2OBSIDIAN_VAULT=${vault}`, "--env", "X2OBSIDIAN_OPEN_NOTE=0"]);
    launched = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    execFileSync("/usr/bin/open", [`x2obsidian://save?url=${encodeURIComponent(source)}`]);
    const deadline = Date.now() + 150000;
    let result;
    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) {
        result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
        if (result.vault === vault || result.status === "error") break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(result?.status, "saved", JSON.stringify(result));
    assert.equal(result.vault, vault);
    const note = fs.readFileSync(path.join(vault, result.note), "utf8");
    assert.ok(note.includes("#### Article Content"), "the requested test article should have a full body");
    assert.ok(note.length > 1000, "the note must contain more than a placeholder");
    console.log(JSON.stringify({ handoff: "passed", status: result.status, characters: note.length, hasArticleBody: true }));
  } finally {
    if (launched) execFileSync("/usr/bin/osascript", ["-e", 'tell application id "com.joey0819.x-to-obsidian" to quit']);
    if (oldResult) fs.writeFileSync(resultFile, oldResult);
    else fs.rmSync(resultFile, { force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
