import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock chrome.storage.local
const store = { scripts: [] };
const chrome = {
  storage: {
    local: {
      get: (defaults, cb) => {
        const res = Object.assign({}, defaults, store);
        cb(res);
      },
      set: (obj, cb) => {
        Object.assign(store, obj);
        if (cb) cb();
      },
    },
  },
  runtime: { lastError: null },
};
globalThis.chrome = chrome;
globalThis.window = globalThis;
// load metadata first so storage can use it
const meta = require("../../src/metadata.js");
globalThis.wasMonkeyMetadata = meta;

const storageMod = require("../../src/storage.js");
const api = globalThis.wasMonkeyStorage;

function reset() { store.scripts = []; }

test("addScript + getScripts", async () => {
  reset();
  await new Promise((res) => api.addScript({ name: "T", code: "// ==WasMonkeyScript==\n// @name T\n// @match *\n// ==/WasMonkeyScript==\n", match: ["*"] }, (e, s) => { assert.equal(e, null); assert.equal(s.name, "T"); res(); }));
  const scripts = await new Promise((res) => api.getScripts((e, s) => res(s)));
  assert.equal(scripts.length, 1);
});

test("listScriptsForUrl filters by match/exclude", async () => {
  reset();
  await new Promise((res) => api.addScript({ name: "A", code: "", match: ["https://a.com/*"], enabled: true }, () => res()));
  await new Promise((res) => api.addScript({ name: "B", code: "", match: ["https://b.com/*"], enabled: true }, () => res()));
  const list = await new Promise((res) => api.listScriptsForUrl("https://a.com/x", (e, s) => res(s)));
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "A");
});

test("toggleScript updates enabled", async () => {
  reset();
  let id;
  await new Promise((res) => api.addScript({ name: "T", code: "", match: ["*"] }, (e, s) => { id = s.id; res(); }));
  await new Promise((res) => api.toggleScript(id, false, (e) => res()));
  const scripts = await new Promise((res) => api.getScripts((e, s) => res(s)));
  assert.equal(scripts[0].enabled, false);
});

test("deleteScript removes", async () => {
  reset();
  let id;
  await new Promise((res) => api.addScript({ name: "T", code: "", match: ["*"] }, (e, s) => { id = s.id; res(); }));
  await new Promise((res) => api.deleteScript(id, (e) => res()));
  const scripts = await new Promise((res) => api.getScripts((e, s) => res(s)));
  assert.equal(scripts.length, 0);
});

test("export/import round-trip", async () => {
  reset();
  await new Promise((res) => api.addScript({ name: "T", code: "x", match: ["*"] }, () => res()));
  const json = await new Promise((res) => api.exportScripts((e, j) => res(j)));
  reset();
  await new Promise((res) => api.importScripts(json, (e, n) => { assert.equal(n, 1); res(); }));
  const scripts = await new Promise((res) => api.getScripts((e, s) => res(s)));
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].name, "T");
});