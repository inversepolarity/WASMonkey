// ==WasMonkeyScript==
// @name        wabt disassemble + log
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WasMonkeyScript==

wasMonkey.onBeforeInstantiate(async (bytes, ctx) => {
  const wabt = await wasMonkey.getWabt();
  if (!wabt) return bytes;
  const mod = wabt.readWasm(bytes, { readDebugNames: true });
  const wat = mod.toText({ foldExprs: false });
  wasMonkey.log("WAT preview:", wat.slice(0, 200));
  return bytes;
});