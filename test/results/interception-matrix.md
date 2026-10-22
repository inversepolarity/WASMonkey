# Phase 0 follow-up — WASM interception matrix (automated, headless)

- Run at: 2026-10-22T07:36:11.357Z
- Browser: Chromium 153.0.8010.0 — mode: `cdp-inject`
- Hook: `src/page-hook.js` (sha256 4e5617cd070b3d60…)
- Mode note: browser build has no extensions subsystem (chrome-headless_shell); src/page-hook.js injected into MAIN world at document_start via Page.addScriptToEvaluateOnNewDocument (the same renderer mechanism used for world:MAIN content scripts). Re-run with --mode extension against full Chrome/Chromium to exercise manifest plumbing.

| # | Profile | Kind | CSP | Hook installed | Kinds intercepted (of 5) | Page WASM compile | Patched re-instantiate | Console parity (CDP vs /collect) | CSP violations |
|---|---------|------|-----|----------------|--------------------------|-------------------|------------------------|----------------------------------|----------------|
| 1 | local-harness | local | `—` | ✅ | 5/5 ✅ | — | — | ✅ 5/5 | 0 |
| 2 | figma | site | `default-src * blob: data: filesystem:; scri…` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 7/7 | 0 |
| 3 | google-earth | site | `script-src 'nonce-<per-response-nonce>' 'un…` | ✅ | 5/5 ✅ | ⛔ blocked | ⛔ | ✅ 5/5 | 0 |
| 4 | mdn | site | `default-src https:; script-src 'self' 'wasm…` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 6/6 | 0 |
| 5 | discord | site | `default-src 'self'; script-src 'self' 'sha2…` | ✅ | 5/5 ✅ | ⛔ blocked | ⛔ | ✅ 5/5 | 0 |
| 6 | google-meet | site | `script-src 'self' 'unsafe-eval' 'unsafe-inl…` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 6/6 | 0 |
| 7 | crazygames | site | `none` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 6/6 | 0 |
| 8 | strict-no-eval | class | `default-src 'self'; object-src 'none'` | ✅ | 5/5 ✅ | ⛔ blocked | ⛔ | ✅ 5/5 | 0 |
| 9 | wasm-unsafe-eval-only | class | `default-src 'self'; script-src 'self' 'wasm…` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 6/6 | 0 |
| 10 | unsafe-eval-only | class | `default-src 'self'; script-src 'self' 'unsa…` | ✅ | 5/5 ✅ | ✅ allowed | ✅ | ✅ 6/6 | 0 |
| 11 | nonce-only | class | `default-src 'self'; script-src 'nonce-<per-…` | ✅ | 5/5 ✅ | ⛔ blocked | ⛔ | ✅ 5/5 | 0 |
| 12 | default-src-none | class | `default-src 'none'` | ✅ | 0/5 ⚠️ | — | — | ✅ 0/0 | 3 |
| 13 | self-plus-cdn | class | `default-src 'self'; script-src 'self' https…` | ✅ | 5/5 ✅ | ⛔ blocked | ⛔ | ✅ 5/5 | 0 |

## Live-site attempts (--url-list)

| Name | URL | Result |
|------|-----|--------|
| figma | https://www.figma.com/ | ❌ net::ERR_CONNECTION_CLOSED at https://www.figma.com/ |
| google-earth | https://earth.google.com/web/ | ❌ net::ERR_CONNECTION_CLOSED at https://earth.google.com/web/ |
| mdn | https://developer.mozilla.org/en-US/docs/WebAssembly | ❌ net::ERR_CONNECTION_CLOSED at https://developer.mozilla.org/en-US/docs/WebAssembly |
| discord | https://discord.com/app | ❌ net::ERR_CONNECTION_CLOSED at https://discord.com/app |
| google-meet | https://meet.google.com/ | ❌ net::ERR_CONNECTION_CLOSED at https://meet.google.com/ |
| crazygames | https://www.crazygames.com/ | ❌ net::ERR_CONNECTION_CLOSED at https://www.crazygames.com/ |

Counts: {"profilesRun":12,"hookInstalled":13,"allFiveKindsIntercepted":12,"consoleParityOk":13,"wasmCompileAllowed":6,"wasmCompileBlocked":5,"patchedReinstantiateAllowed":6}
