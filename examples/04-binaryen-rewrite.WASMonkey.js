// ==WASMonkeyScript==
// @name        Binaryen IR rewrite
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate(async (bytes, ctx) => {
  const Binaryen = await WASMonkey.getBinaryen();
  if (!Binaryen) return bytes;
  const text = await WASMonkey.disassemble(bytes);
  WASMonkey.log("disassembled", text.length, "chars");
  // Re-assemble unchanged to prove round-trip; modify text here for real patches.
  return await WASMonkey.assemble(text);
});