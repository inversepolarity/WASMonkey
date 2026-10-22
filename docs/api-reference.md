# wasMonkey Developer API Reference (v1)

Scripts run in the page's MAIN world. The global `wasMonkey` object is provided
to each script's execution context. The global `window.__wasMonkey` exposes the
same surface for tooling.

## Grants (@grant)

Declare required capabilities in the metadata header. A script without the
relevant grant cannot register the corresponding hook.

- `patchBytes` — required for `onBeforeInstantiate`.
- `patchExports` — required for `onAfterInstantiate` (also granted by `patchBytes`).
- `network` — reserved for network access (future).

## Interface

```ts
interface WasMonkeyAPI {
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
// ==WasMonkeyScript==
// @name        Example
// @match       *
// @grant       patchBytes
// ==/WasMonkeyScript==

wasMonkey.onBeforeInstantiate((bytes, ctx) => {
  wasMonkey.log("intercepted", bytes.byteLength);
  return bytes;
});
```