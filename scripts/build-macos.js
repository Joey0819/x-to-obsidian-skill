#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appName = "X to Obsidian.app";

function build() {
  if (process.platform !== "darwin") throw new Error("Building the desktop app requires macOS.");
  const app = path.join(root, "artifacts", appName);
  fs.rmSync(app, { recursive: true, force: true });
  const contents = path.join(app, "Contents");
  const executable = path.join(contents, "MacOS", "XToObsidian");
  const resources = path.join(contents, "Resources");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  fs.copyFileSync(path.join(root, "desktop", "Info.plist"), path.join(contents, "Info.plist"));
  for (const file of ["sync-x-to-obsidian.js", "desktop-capture.js"]) {
    fs.copyFileSync(path.join(root, "scripts", file), path.join(resources, file));
  }
  fs.copyFileSync(path.join(root, "desktop", "bookmark.html"), path.join(resources, "bookmark.html"));
  execFileSync("/usr/bin/xcrun", [
    "swiftc", "-swift-version", "5", "-O", "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos12.0`,
    path.join(root, "desktop", "CaptureCore.swift"), path.join(root, "desktop", "main.swift"),
    "-framework", "AppKit", "-o", executable,
  ], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  execFileSync(executable, ["--check-ui"], { stdio: "inherit" });
  // Running AppKit can register the build copy; only the installed copy should handle links.
  execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", app]);
  console.log(`Built / 已构建: ${app}`);
  return app;
}

function install(app) {
  const target = path.join(os.homedir(), "Applications", appName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const identifier = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(target, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
    if (identifier !== "com.joey0819.x-to-obsidian") throw new Error("An unrelated app already uses the destination name.");
    if (spawnSync("/usr/bin/pgrep", ["-x", "XToObsidian"]).status === 0) {
      execFileSync("/usr/bin/osascript", ["-e", 'tell application id "com.joey0819.x-to-obsidian" to quit']);
    }
  }
  const stage = fs.mkdtempSync(path.join(path.dirname(target), ".x2obsidian-install-"));
  const stagedApp = path.join(stage, appName);
  const previous = path.join(stage, "previous.app");
  try {
    fs.cpSync(app, stagedApp, { recursive: true });
    if (fs.existsSync(target)) fs.renameSync(target, previous);
    try { fs.renameSync(stagedApp, target); }
    catch (error) {
      if (fs.existsSync(previous)) fs.renameSync(previous, target);
      throw error;
    }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target]);
  console.log(`Installed / 已安装: ${target}`);
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--install")) throw new Error("Usage: build-macos.js [--install]");
    const app = build();
    if (process.argv.includes("--install")) install(app);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { build, install };
