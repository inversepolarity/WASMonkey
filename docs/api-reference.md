# WASMonkey Developer API Reference (v1)

Scripts run in the page's MAIN world. The global `WASMonkey` object is provided
to each script's execution context. The global `window.__WASMonkey` exposes the
same surface for tooling.

## Grants (@grant)

Declare required capabilities in the metadata header. A script without the
relevant grant cannot register the corresponding hook. Grants from the header
and from the stored script record (the editor's grant field) are merged, so a
header-only `// @grant patchBytes` is always honoured.

- `patchBytes` — required for `onBeforeInstantiate`.
- `patchExports` — required for `onAfterInstantiate` (also granted by `patchBytes`).
- `network` — reserved for network access (future).

## Delivery & startup

Scripts are serialized by the isolated-world bridge and handed to the page on
the `WASMonkey:scripts` document event. Delivery is race-free across browsers:
the bridge pushes the matching scripts as soon as it starts (and again on
`DOMContentLoaded`, `load`, `pageshow`, and whenever the script store changes),
while the page side re-requests with backoff until it has an answer.

- The first async `WebAssembly.instantiate`, `instantiateStreaming`, `compile`
  or `compileStreaming` call waits up to `startupGraceMs` (default `300`, set it
  in `chrome.storage.local`; `0` disables) for the payload, so a module loaded
  at `document_start` can still be patched by `onBeforeInstantiate`.
- `onAfterInstantiate` is replayed for instances created before the scripts
  arrived (up to 8 of them). Those calls carry `ctx.replayed === true`.
- Re-delivery is idempotent: a script body runs once per stored revision
  (`id` + `updatedAt`), so re-pushes and storage changes never double-register
  hooks.
- `__WASMonkeyRefreshScripts()` re-syncs manually from the console.
- If no payload arrives at all, the console warns
  `[WASMonkey] no script payload received from the isolated bridge…` instead of
  failing silently.

## Interface

```ts
interface WASMonkeyAPI {
  readonly apiVersion: 1;
  log(...args): void;
  getBinaryen(): Promise<Binaryen>;
  getWabt(): Promise<Wabt>;
  disassemble(bytes: Uint8Array): Promise<string>;
  assemble(wat: string): Promise<Uint8Array>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  onBeforeInstantiate(cb: (bytes, ctx) => Uint8Array | void | Promise<...>): void;
  onAfterInstantiate(cb: (exports, ctx) => void): void;
  storage: { get(key): Promise<any>; set(key, val): Promise<void> };
  utils: PatchUtils | null;
}
```

## LoadContext

`{ url, initiatorStack, byteLength, frameUrl }`.

## Methods

- `log(...args)` — prefixed console output.
- `getBinaryen()` / `getWabt()` — lazy-load vendored toolkit builds (cached).
- `disassemble(bytes)` — WAT text via wabt.
- `assemble(wat)` — bytes via wabt.
- `hashBytes(bytes)` — SHA-256 hex digest.
- `onBeforeInstantiate(cb)` — register a callback invoked with `(bytes, ctx)` before each WASM instantiation; return patched bytes (or void to pass through). Requires `@grant patchBytes`.
- `onAfterInstantiate(cb)` — register a callback invoked with `(exports, ctx)` after instantiation. Requires `@grant patchExports` (or `patchBytes`).
- `storage.get/set` — per-script sandboxed storage (localStorage-backed in v1).
- `utils` — patch primitives from `src/patch-utils.js`.

## Example

```js
// ==WASMonkeyScript==
// @name        Example
// @match       *
// @grant       patchBytes
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  WASMonkey.log("intercepted", bytes.byteLength);
  return bytes;
});
```