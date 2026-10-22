import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pu = require("../../src/patch-utils.js");

test("ULEB128 round-trip", () => {
  for (const v of [0, 1, 127, 128, 255, 1000, 65535]) {
    const enc = pu.encodeUleb128(v);
    const dec = pu.decodeUleb128(enc, 0);
    assert.equal(dec.value, v);
  }
});

test("SLEB128 round-trip", () => {
  for (const v of [0, 1, -1, 42, -42, 127, -128, 1000, -1000]) {
    const enc = pu.encodeSleb128(v);
    const dec = pu.decodeSleb128(enc, 0);
    assert.equal(dec.value, v, "value " + v);
  }
});

test("patchConstant replaces SLEB128 value", () => {
  const enc42 = pu.encodeSleb128(42);
  const data = new Uint8Array([1, 2, ...enc42, 3]);
  const patched = pu.patchConstant(data, 42, 7);
  const enc7 = pu.encodeSleb128(7);
  // patched should contain enc7 and not enc42
  const str = Array.from(patched).join(",");
  assert.ok(str.includes(Array.from(enc7).join(",")));
  assert.ok(!str.includes(Array.from(enc42).join(",")));
});

test("patchConstant no-op when value absent", () => {
  const data = new Uint8Array([1, 2, 3]);
  const patched = pu.patchConstant(data, 999, 7);
  assert.deepEqual(Array.from(patched), [1, 2, 3]);
});