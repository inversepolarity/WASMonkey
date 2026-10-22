import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Load metadata.js (UMD-style, sets module.exports in Node)
const meta = require("../../src/metadata.js");

test("parseMetadata extracts name/match/exclude/grants/version", () => {
  const code = `// ==WasMonkeyScript==
// @name        Foo
// @match       https://example.com/*
// @match       https://other.com/*
// @exclude     https://example.com/admin/*
// @grant       patchBytes patchExports
// @version     1.2.3
// ==/WasMonkeyScript==
wasMonkey.log("hi");`;
  const m = meta.parseMetadata(code);
  assert.equal(m.name, "Foo");
  assert.deepEqual(m.match, ["https://example.com/*", "https://other.com/*"]);
  assert.deepEqual(m.exclude, ["https://example.com/admin/*"]);
  assert.deepEqual(m.grants, ["patchBytes", "patchExports"]);
  assert.equal(m.version, "1.2.3");
});

test("parseMetadata defaults", () => {
  const m = meta.parseMetadata("console.log(1)");
  assert.equal(m.name, "Untitled script");
  assert.deepEqual(m.match, ["*"]);
  assert.deepEqual(m.grants, []);
});

test("globToRegex handles wildcards", () => {
  const r = meta.globToRegex("https://example.com/*");
  assert.ok(r.test("https://example.com/foo"));
  assert.ok(!r.test("https://other.com/foo"));
});

test("globToRegex supports regex literals", () => {
  const r = meta.globToRegex("/foo\\d+/");
  assert.ok(r.test("foo42"));
  assert.ok(!r.test("bar"));
});

test("scriptMatches respects exclude precedence", () => {
  const script = { enabled: true, match: ["*"], exclude: ["https://example.com/secret/*"] };
  assert.equal(meta.scriptMatches(script, "https://example.com/page"), true);
  assert.equal(meta.scriptMatches(script, "https://example.com/secret/x"), false);
  assert.equal(meta.scriptMatches({ enabled: false, match: ["*"] }, "https://x.com"), false);
});