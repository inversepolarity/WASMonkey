// ==WasMonkeyScript==
// @name        WASM load logger
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WasMonkeyScript==

wasMonkey.onBeforeInstantiate((bytes, ctx) => {
  wasMonkey.log("WASM load:", bytes.byteLength, "bytes at", ctx.url);
  return bytes;
});
