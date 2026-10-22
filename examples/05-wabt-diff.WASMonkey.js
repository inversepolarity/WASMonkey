// ==WASMonkeyScript==
// @name        wabt disassemble + log
// @match       *
// @grant       patchBytes
// @version     1.0
// ==/WASMonkeyScript==

WASMonkey.onBeforeInstantiate(async (bytes, ctx) => {
  const wabt = await WASMonkey.getWabt();
  if (!wabt) return bytes;
  const mod = wabt.readWasm(bytes, { readDebugNames: true });
  const wat = mod.toText({ foldExprs: false });
  WASMonkey.log("WAT preview:", wat.slice(0, 200));
  return bytes;
});