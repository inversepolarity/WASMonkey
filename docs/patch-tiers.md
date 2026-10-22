# Patch Tiers for wasMonkey Script Authors

## Tier 1 — Export wrapping (no binary knowledge)
Wrap JS-visible exports in `onAfterInstantiate`. Easiest; no WASM internals needed.
See `examples/02-export-wrapper.wasmonkey.js`.

## Tier 2 — Constant / byte patching (medium)
Modify raw bytes before instantiation using `wasMonkey.utils.patchConstant` (LEB128/SLEB128-aware) or manual byte edits. Requires basic knowledge of the binary format.
See `examples/03-byte-patcher.wasmonkey.js`.

## Tier 3 — Full IR rewriting via Binaryen / wabt (advanced)
Parse bytes into IR with `wasMonkey.getBinaryen()` / `wasMonkey.getWabt()`, modify functions, re-emit. Most powerful; requires WASM IR knowledge.
See `examples/04-binaryen-rewrite.wasmonkey.js`, `examples/05-wabt-diff.wasmonkey.js`.

## wasMonkey API (Phase 4 additions)
- `getBinaryen()` / `getWabt()` — lazy-load vendored toolkit builds (cached after first call).
- `disassemble(bytes)` — WAT text via wabt.
- `assemble(wat)` — bytes via wabt.
- `utils.patchConstant(bytes, oldValue, newValue)` — LEB128/SLEB128-aware constant replacement.
- `utils.encodeUleb128/decodeUleb128/encodeSleb128/decodeSleb128` — helpers.