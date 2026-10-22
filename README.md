# WASMonkey — Tampermonkey for WebAssembly

A cross-browser (Chrome/Chromium, Firefox) extension that intercepts, inspects,
and patches WebAssembly modules at load time.

## Features

- Intercepts all six WASM entry points (`instantiate`, `instantiateStreaming`,
  `compile`, `compileStreaming`, `new WebAssembly.Module`, `new WebAssembly.Instance`).
- Pass-through logging with byte length, source URL, and triggering stack trace.
- User scripts with Tampermonkey-style metadata headers and `@grant` enforcement.
- Management dashboard with CodeMirror 6 editor, templates, import/export.
- Toolbar popup: detected modules, active scripts, panic switch.
- Binaryen.js + wabt.js toolkit for IR-level rewriting.
- Patch cache (IndexedDB) + fast-path passthrough.
- CSP handling, per-script error isolation, record mode.

## Install (manual / sideload)

### Chrome / Chromium / Edge / Brave
1. Download `WASMonkey-chrome.zip` (or build: `node tools/build.mjs chrome`).
2. Unzip to a folder.
3. Open `chrome://extensions`, enable Developer mode.
4. Click "Load unpacked" and select the folder.

### Firefox
1. Download `WASMonkey-firefox.zip` (or build: `node tools/build.mjs firefox`).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on" and select `manifest.json` inside the unzipped folder.

## Usage

1. Click the toolbar icon → "Open dashboard".
2. Go to **Scripts** → "New script" or "New from template".
3. Write your script using the `WASMonkey` API (see below), set `@match`, grants.
4. Click **Save** (or **Save & Reload Active Tab**).
5. Navigate to a matching page; open DevTools console to see intercepted loads.

### Writing a script

```js
// ==WASMonkeyScript==
// @name        My script
// @match       *
// @grant       patchBytes
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  WASMonkey.log("intercepted", bytes.byteLength, "bytes at", ctx.url);
  return bytes; // return patched bytes, or original to pass through
});

WASMonkey.onAfterInstantiate((exports, ctx) => {
  WASMonkey.log("exports:", Object.keys(exports));
});
```

### WASMonkey API (v1)

- `WASMonkey.log(...args)`
- `WASMonkey.getBinaryen()` / `WASMonkey.getWabt()` — lazy-load toolkits.
- `WASMonkey.disassemble(bytes)` → WAT string; `WASMonkey.assemble(wat)` → bytes.
- `WASMonkey.hashBytes(bytes)` → SHA-256 hex.
- `WASMonkey.onBeforeInstantiate(cb)` — requires `@grant patchBytes`.
- `WASMonkey.onAfterInstantiate(cb)` — requires `@grant patchExports` (or `patchBytes`).
- `WASMonkey.storage.get/set` — per-script sandboxed storage.
- `WASMonkey.utils` — `patchConstant`, LEB128 encode/decode, etc.

See `docs/api-reference.md` and `src/WASMonkey.d.ts`.

### Grants

- `patchBytes` — register `onBeforeInstantiate`.
- `patchExports` — register `onAfterInstantiate`.
- `network` — reserved.

### Panic switch

Global disable + per-site disable in the popup. Settings → "Global enable".

### Record mode

Settings → "Record mode" logs every instantiate's stack trace + byte hash.

## Examples

See `examples/` for five starter scripts (logger, export-wrapper, byte-patcher,
Binaryen rewrite, wabt diff).

## Development

```bash
npm install  # in tools/phase0 for test tooling
node tools/phase0/vendor.mjs       # vendor Binaryen/wabt
node tools/phase0/smoke.mjs        # smoke test
node tools/phase0/matrix.mjs       # CSP matrix
node tools/phase0/fuzz.mjs         # fuzz test
node --test test/unit/*.test.mjs   # unit tests
node tools/build.mjs chrome        # build
```

## Docs

- `docs/api-reference.md`
- `docs/patch-tiers.md`
- `docs/threat-model.md`
- `docs/privacy-policy.md`
- `docs/sideload.md`
- `docs/faq.md`

## License

See repository.