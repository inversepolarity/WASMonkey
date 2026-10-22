# Phase 0 follow-up — Binaryen/wabt browser-build spike (per CSP profile)

- Run at: 2026-10-22T08:36:01.070Z
- Browser: Chromium 153.0.8010.0 — mode: `cdp-inject`
- Vendored builds: `vendor/binaryen/index.js` (binaryen@132.0.0 ESM, embedded wasm), `vendor/wabt/index.js` (wabt@1.0.39 UMD, embedded wasm) — pinned by `tools/phase0/vendor.lock.json`

| Profile | Kind | Hook | wabt load | wabt init+parse+instantiate | Binaryen import | Binaryen parse+instantiate | hook getWabt() | hook getBinaryen() | CSP violations |
|---------|------|------|-----------|------------------------------|-----------------|----------------------------|----------------|--------------------|----------------|
| figma | site | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| google-earth | site | ✅ | nonce ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 1 |
| mdn | site | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| discord | site | ✅ | plain ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 0 |
| google-meet | site | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| crazygames | site | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| strict-no-eval | class | ✅ | plain ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 0 |
| wasm-unsafe-eval-only | class | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| unsafe-eval-only | class | ✅ | plain ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| nonce-only | class | ✅ | nonce ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 1 |
| default-src-none | class | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 5 |
| self-plus-cdn | class | ✅ | plain ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | 0 |

Counts: {"profilesRun":12,"hookInstalled":12,"wabtFullRoundtripOk":6,"binaryenFullRoundtripOk":6,"consoleParityOk":12}

Step-level error details are in `toolkit-spike.json` (`results[].steps[].error`).
