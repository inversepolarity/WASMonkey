// Regression tests for user-script delivery (MAIN world <- ISOLATED bridge).
//
// Firefox injects content scripts into one document at document_start in
// manifest order and — unlike Chrome — does NOT route CustomEvents dispatched
// by a MAIN-world content script to an ISOLATED-world script that has not
// finished loading yet. page-hook.js used to fire a single
// "WASMonkey:request-scripts" event at the end of its own execution, i.e.
// strictly before isolated-bridge.js had registered its listener, so no script
// ever reached the page and no hook ever fired.
//
// These tests build two vm "worlds" over one shared document event bus and
// replay that ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
const wasmPath = fileURLToPath(new URL("../sample.wasm", import.meta.url));

const PAGE_URL = "https://surajsharma.github.io/wasm-game-of-life/";

const USER_SCRIPT = `// ==WASMonkeyScript==
// @name        My script
// @match       *
// @grant       patchBytes
// ==/WASMonkeyScript==

WASMonkey.log("hello from WASMonkey script");

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  WASMonkey.log("intercepted", bytes.byteLength, "bytes");
  return bytes; // return patched bytes (or original to pass through)
});

WASMonkey.onAfterInstantiate((exports, ctx) => {
  WASMonkey.log("exports:", Object.keys(exports));
});
`;

function readSrc(name) {
  return fs.readFileSync(path.join(srcDir, name), "utf8");
}

// --- tiny fake DOM ---------------------------------------------------------

function createDocument() {
  const listeners = new Map();
  const add = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  const dispatch = (type, detail) => {
    const fns = (listeners.get(type) || []).slice();
    for (const fn of fns) {
      try { fn({ type, detail, target: doc }); } catch (e) { /* page code errors don't stop the bus */ }
    }
    return fns.length;
  };
  const doc = {
    readyState: "loading",
    addEventListener: add,
    removeEventListener: (type, fn) => {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent: (ev) => dispatch(ev.type, ev.detail),
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), textContent: "", src: "", async: false, remove() {}, setAttribute() {} }),
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    // test helpers
    _dispatch: dispatch,
    _listenerCount: (type) => (listeners.get(type) || []).length,
  };
  return doc;
}

// Each world gets its own copy of the WebAssembly namespace object so that
// page-hook.js patching it does not leak into the host realm (or the other
// world).
function makeWebAssemblyNamespace() {
  const ns = {};
  for (const key of Object.getOwnPropertyNames(WebAssembly)) {
    ns[key] = WebAssembly[key];
  }
  return ns;
}

function makeWorld({ doc, logs, chrome }) {
  const sandbox = {
    document: doc,
    location: {
      href: PAGE_URL,
      hostname: "surajsharma.github.io",
      origin: "https://surajsharma.github.io",
      port: "",
      protocol: "https:",
    },
    navigator: { serviceWorker: null, userAgent: "test" },
    WebAssembly: makeWebAssemblyNamespace(),
    crypto: globalThis.crypto,
    indexedDB: undefined,
    localStorage: {
      _d: new Map(),
      getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
      setItem(k, v) { this._d.set(k, String(v)); },
      removeItem(k) { this._d.delete(k); },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob: class Blob { constructor(parts) { this.parts = parts; } },
    XMLHttpRequest: class XMLHttpRequest {
      open() {}
      send() { throw new Error("no network in tests"); }
    },
    console: {
      log: (...a) => logs.push(["log", a.map(String).join(" ")]),
      warn: (...a) => logs.push(["warn", a.map(String).join(" ")]),
      error: (...a) => logs.push(["error", a.map(String).join(" ")]),
      info: (...a) => logs.push(["info", a.map(String).join(" ")]),
      debug: (...a) => logs.push(["debug", a.map(String).join(" ")]),
    },
    chrome,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

function run(world, code, filename) {
  return vm.runInContext(code, world, { filename });
}

function makeChrome({ scripts, onGet } = {}) {
  const storage = { scripts: scripts || [] };
  const listeners = [];
  return {
    runtime: {
      getURL: (p) => "moz-extension://test-id/" + (p || ""),
      lastError: null,
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get(defaults, cb) {
          const wantsScripts = defaults && Object.prototype.hasOwnProperty.call(defaults, "scripts");
          if (wantsScripts && onGet) onGet();
          const out = Object.assign({}, defaults);
          for (const k of Object.keys(out)) {
            if (Object.prototype.hasOwnProperty.call(storage, k)) out[k] = storage[k];
          }
          setTimeout(() => cb(out), 0);
        },
        set(obj, cb) {
          Object.assign(storage, obj);
          for (const fn of listeners.slice()) fn({ scripts: { newValue: obj.scripts } }, "local");
          if (cb) setTimeout(cb, 0);
        },
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); },
      },
    },
    declarativeNetRequest: { updateDynamicRules(_r, cb) { if (cb) cb(); } },
    tabs: { query() {}, reload() {} },
  };
}

// Script record as produced by storage.addScript() / the options UI.
function scriptRecord(code) {
  return {
    id: "wm_test",
    name: "My script",
    match: ["*"],
    exclude: [],
    code,
    enabled: true,
    grants: ["patchBytes"],
    runAt: "document-start",
    version: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

async function waitFor(predicate, timeoutMs = 3000, step = 10) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return predicate();
}

// Replays the browser injection order that breaks: MAIN world first, then
// (same document_start batch) metadata + storage + isolated-bridge.
async function bootPage({ scripts, grantPatch } = {}) {
  const logs = [];
  const doc = createDocument();
  const main = makeWorld({ doc, logs, chrome: undefined });
  const chromeApi = makeChrome({ scripts });

  run(main, readSrc("page-hook.js"), "page-hook.js");        // world: MAIN
  const isolated = makeWorld({ doc, logs, chrome: chromeApi });
  run(isolated, readSrc("metadata.js"), "metadata.js");      // world: ISOLATED
  run(isolated, readSrc("storage.js"), "storage.js");
  run(isolated, readSrc("isolated-bridge.js"), "isolated-bridge.js");
  return { logs, doc, main, isolated, chromeApi };
}

async function instantiateInPage(world) {
  // Bytes must be created inside the page realm: page-hook.js uses `instanceof`
  // checks that do not survive a cross-realm ArrayBuffer.
  world.__testBytes = Array.from(fs.readFileSync(wasmPath));
  await vm.runInContext(
    "globalThis.__result = WebAssembly.instantiate(new Uint8Array(globalThis.__testBytes).buffer, {})" +
      ".then(r => { globalThis.__exportKeys = Object.keys(r.instance.exports); return r; }," +
      " e => { globalThis.__err = e; return null; });",
    world,
  );
  return vm.runInContext("globalThis.__result", world);
}

test("scripts reach the page even though the bridge loads after page-hook (Firefox document_start ordering)", async () => {
  const { logs, main } = await bootPage({ scripts: [scriptRecord(USER_SCRIPT)] });

  const delivered = await waitFor(() => logs.some(([, m]) => m.includes("hello from WASMonkey script")));
  assert.ok(delivered, "user script body never executed; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"));

  await instantiateInPage(main);

  assert.ok(
    logs.some(([, m]) => m.includes("intercepted") && /\d+ bytes/.test(m)),
    "onBeforeInstantiate hook never fired; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
  assert.ok(
    logs.some(([, m]) => m.includes("exports:")),
    "onAfterInstantiate hook never fired; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
});

test("hooks still fire when the bridge loads first and page-hook requests scripts directly", async () => {
  const logs = [];
  const doc = createDocument();
  const chromeApi = makeChrome({ scripts: [scriptRecord(USER_SCRIPT)] });

  const isolated = makeWorld({ doc, logs, chrome: chromeApi });
  run(isolated, readSrc("metadata.js"), "metadata.js");
  run(isolated, readSrc("storage.js"), "storage.js");
  run(isolated, readSrc("isolated-bridge.js"), "isolated-bridge.js");

  const main = makeWorld({ doc, logs, chrome: undefined });
  run(main, readSrc("page-hook.js"), "page-hook.js");

  const delivered = await waitFor(() => logs.some(([, m]) => m.includes("hello from WASMonkey script")));
  assert.ok(delivered, "user script not delivered when bridge loaded first");

  await instantiateInPage(main);
  assert.ok(logs.some(([, m]) => m.includes("intercepted")), "onBeforeInstantiate hook never fired");
  assert.ok(logs.some(([, m]) => m.includes("exports:")), "onAfterInstantiate hook never fired");
});

test("repeated pushes do not run the same script twice", async () => {
  const { logs, doc, chromeApi } = await bootPage({ scripts: [scriptRecord(USER_SCRIPT)] });
  await waitFor(() => logs.some(([, m]) => m.includes("hello from WASMonkey script")));

  const before = logs.filter(([, m]) => m.includes("hello from WASMonkey script")).length;
  // Simulate another delivery trigger (DOMContentLoaded / storage change / retry).
  doc._dispatch("WASMonkey:scripts", JSON.stringify({ scripts: [scriptRecord(USER_SCRIPT)], version: "2" }));
  doc._dispatch("WASMonkey:request-scripts", PAGE_URL);
  await new Promise((r) => setTimeout(r, 200));
  const after = logs.filter(([, m]) => m.includes("hello from WASMonkey script")).length;

  assert.equal(before, 1, "script body should run exactly once");
  assert.equal(after, 1, "duplicate delivery must not re-run the script body");
  assert.ok(chromeApi, "chrome stub present");
});

test("hooks register from the code header when stored grants are missing", async () => {
  const record = scriptRecord(USER_SCRIPT);
  record.grants = [];
  record.name = ""; // force header parsing to be the only source of grants
  const { logs, main } = await bootPage({ scripts: [record] });

  await waitFor(() => logs.some(([, m]) => m.includes("hello from WASMonkey script")));
  await instantiateInPage(main);

  assert.ok(
    logs.some(([, m]) => m.includes("intercepted")),
    "@grant patchBytes declared in the script header must be honoured; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
  assert.ok(!logs.some(([l, m]) => l === "warn" && m.includes("lacks @grant") && m.includes("onBeforeInstantiate")),
    "should not warn about a missing grant that the header declares");
});

test("a module instantiated before delivery still gets onAfterInstantiate (replay)", async () => {
  const logs = [];
  const doc = createDocument();
  const main = makeWorld({ doc, logs, chrome: undefined });
  run(main, readSrc("page-hook.js"), "page-hook.js");

  // No bridge yet: the site's bootstrap instantiates immediately.
  await instantiateInPage(main);
  assert.ok(
    logs.some(([, m]) => m.includes("instantiate")),
    "module creation should be logged even when no scripts are loaded yet",
  );
  assert.ok(!logs.some(([, m]) => m.includes("exports:")), "no hooks are registered yet");

  // Bridge finally delivers.
  doc._dispatch("WASMonkey:scripts", JSON.stringify({ scripts: [scriptRecord(USER_SCRIPT)], version: "1" }));

  assert.ok(
    logs.some(([, m]) => m.includes("exports:") && m.includes("add")),
    "onAfterInstantiate should be replayed for the already-created instance; logs:\n" +
      logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
});

test("first instantiation waits out a cold bridge so onBeforeInstantiate can patch", async () => {
  const logs = [];
  const doc = createDocument();
  const main = makeWorld({ doc, logs, chrome: undefined });
  run(main, readSrc("page-hook.js"), "page-hook.js");

  // Start instantiating BEFORE any script is known (cold start), then deliver
  // the script payload a few milliseconds later, like a real storage round-trip.
  const inflight = instantiateInPage(main);
  setTimeout(() => {
    doc._dispatch("WASMonkey:scripts", JSON.stringify({ scripts: [scriptRecord(USER_SCRIPT)], version: "1" }));
  }, 25);
  await inflight;

  assert.ok(
    logs.some(([, m]) => m.includes("intercepted")),
    "startup grace should keep the first module open long enough for the hook to see it; logs:\n" +
      logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
});

test("no bridge at all: startup grace costs at most one bounded wait", async () => {
  const logs = [];
  const doc = createDocument();
  const main = makeWorld({ doc, logs, chrome: undefined });
  run(main, readSrc("page-hook.js"), "page-hook.js");
  main.__WASMonkeyStartupGraceMs = 150;

  const t0 = Date.now();
  await instantiateInPage(main);
  const first = Date.now() - t0;
  const t1 = Date.now();
  await instantiateInPage(main);
  const second = Date.now() - t1;

  assert.ok(first >= 100, "first module should wait for the grace window, took " + first + "ms");
  assert.ok(second < 100, "later modules must not pay the grace cost again, took " + second + "ms");
});

test("hooks fire for instantiateStreaming(Response) like the bootstrap does", async () => {
  const { logs, main } = await bootPage({ scripts: [scriptRecord(USER_SCRIPT)] });
  await waitFor(() => logs.some(([, m]) => m.includes("hello from WASMonkey script")));

  const raw = fs.readFileSync(wasmPath);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const response = new Response(ab, { headers: { "content-type": "application/wasm" } });
  Object.defineProperty(response, "url", { value: PAGE_URL + "da61dfefe2f9a8d4a410.module.wasm" });
  // A resolved fetch() promise, exactly what webpack's requireEnsure hands over.
  main.__resp = Promise.resolve(response);

  await vm.runInContext(
    "globalThis.__s = WebAssembly.instantiateStreaming(globalThis.__resp, {})" +
      ".then(r => { globalThis.__sKeys = Object.keys(r.instance.exports); return r; }," +
      " e => { globalThis.__sErr = e; return null; });",
    main,
  );
  await vm.runInContext("globalThis.__s", main);

  const err = vm.runInContext("globalThis.__sErr", main);
  assert.equal(err, undefined, "instantiateStreaming must still resolve: " + (err && err.message));

  assert.ok(
    logs.some(([, m]) => m.includes("instantiateStreaming") && m.includes("41 bytes")),
    "the module should still be detected; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
  assert.ok(
    logs.some(([, m]) => m.includes("intercepted")),
    "onBeforeInstantiate should fire for instantiateStreaming; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
  assert.ok(
    logs.some(([, m]) => m.includes("exports:") && m.includes("add")),
    "onAfterInstantiate should fire with the real exports; logs:\n" + logs.map(([l, m]) => l + ": " + m).join("\n"),
  );
});
