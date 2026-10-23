"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function bookmarklet() {
  const html = fs.readFileSync(path.join(__dirname, "../desktop/bookmark.html"), "utf8");
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const anchor = {};
  vm.runInNewContext(source, { document: { getElementById: () => anchor } });
  return anchor.href.replace(/^javascript:/, "");
}

test("browser bookmark hands the current X post to the app with correct URL encoding", () => {
  const location = { hostname: "x.com", pathname: "/example/status/1234567890", href: "https://x.com/example/status/1234567890?s=20&ref=a" };
  vm.runInNewContext(bookmarklet(), { location, encodeURIComponent, alert: () => assert.fail("unexpected warning") });
  const deepLink = new URL(location.href);
  assert.equal(deepLink.protocol, "x2obsidian:");
  assert.equal(deepLink.hostname, "save");
  assert.equal(deepLink.searchParams.get("url"), "https://x.com/example/status/1234567890?s=20&ref=a");
});

test("bookmark warns on X home or another site instead of dispatching a capture", () => {
  for (const source of ["https://x.com/home", "https://example.org/example/status/123"]) {
    const url = new URL(source);
    const location = { hostname: url.hostname, pathname: url.pathname, href: url.href };
    let warnings = 0;
    vm.runInNewContext(bookmarklet(), { location, encodeURIComponent, alert: () => warnings++ });
    assert.equal(warnings, 1);
    assert.equal(location.href, source);
  }
});
