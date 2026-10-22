// ==WasMonkeyScript==
// @name        Binaryen IR rewrite
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WasMonkeyScript==

wasMonkey.onBeforeInstantiate(async (bytes, ctx) => {
  const Binaryen = await wasMonkey.getBinaryen();
  if (!Binaryen) return bytes;
  const text = await wasMonkey.disassemble(bytes);
  wasMonkey.log("disassembled", text.length, "chars");
  // Re-assemble unchanged to prove round-trip; modify text here for real patches.
  return await wasMonkey.assemble(text);
});