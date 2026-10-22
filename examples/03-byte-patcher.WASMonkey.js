// ==WASMonkeyScript==
// @name        Byte patcher (constant)
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  // Flip a constant 42 -> 7 in the binary (SLEB128-aware).
  const patched = WASMonkey.utils.patchConstant(bytes, 42, 7);
  if (patched.length !== bytes.length) WASMonkey.log("patched length", patched.length);
  return patched;
});