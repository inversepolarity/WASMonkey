// ==WASMonkeyScript==
// @name        WASM load logger
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  WASMonkey.log("WASM load:", bytes.byteLength, "bytes at", ctx.url);
  return bytes;
});
