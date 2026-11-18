"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function realDirectory(input) {
  try {
    if (typeof input !== "string" || !input || !fs.statSync(input).isDirectory()) return "";
    return fs.realpathSync(input);
  } catch { return ""; }
}

function registeredVaults() {
  if (process.platform !== "darwin") return [];
  try {
    const file = path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.values(config.vaults || {}).map(vault => realDirectory(vault?.path)).filter(Boolean);
  } catch { return []; }
}

function resolveVaultRoot(selected, registered = registeredVaults()) {
  let dir = realDirectory(selected);
  while (dir) {
    if (registered.includes(dir) || realDirectory(path.join(dir, ".obsidian"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Choose an existing Obsidian vault folder / 请选择已有的 Obsidian 仓库。");
}

function openSavedNote(vault, relativePath, {
  platform = process.platform,
  registered = registeredVaults(),
  dispatch = url => execFileSync("/usr/bin/open", [url]),
} = {}) {
  if (platform !== "darwin") return { opened: false, openWarning: "Open the saved note manually; automatic opening requires macOS." };
  if (!registered.includes(vault)) {
    return { opened: false, openWarning: "Open this vault in Obsidian first; your note is saved. / 笔记已保存，请先在 Obsidian 中打开此仓库。" };
  }
  let absolute;
  try {
    absolute = fs.realpathSync(path.resolve(vault, relativePath));
    const fromRoot = path.relative(vault, absolute);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(".." + path.sep) || path.isAbsolute(fromRoot) || !fs.statSync(absolute).isFile()) {
      throw new Error("Not a vault note.");
    }
  } catch {
    return { opened: false, openWarning: "Could not locate the saved note inside the selected vault." };
  }
  try {
    dispatch(`obsidian://open?path=${encodeURIComponent(absolute)}`);
    return { opened: true };
  } catch {
    return { opened: false, openWarning: "Obsidian could not be launched; your note is saved. / 无法启动 Obsidian，笔记已保存。" };
  }
}

module.exports = { resolveVaultRoot, openSavedNote };
