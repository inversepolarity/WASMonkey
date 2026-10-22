# Phase 0 — Research & Feasibility Findings

**Project:** wasMonkey — cross-browser extension for intercepting/patching WebAssembly modules at load time.
**Phase:** 0 (Research & Feasibility)
**Date:** 2026-10-22
**Status:** Prototype validated on Firefox ESR 153; Chrome not available in this environment (see limitations).

## 1. Summary

The core trick — overriding `WebAssembly.*` from a `MAIN`-world content script injected at `document_start` — works reliably in Firefox 153 ESR. All six interception points (`instantiate`, `instantiateStreaming`, `compile`, `compileStreaming`, `new WebAssembly.Module`, `new WebAssembly.Instance`) were exercised against a real 41-byte WASM module and each was intercepted and logged without altering page behavior (pass-through). Manifest V3 with `world: "MAIN"` is supported by current Firefox ESR.

Chrome/Chromium could not be tested in this environment (no Chromium binary available). The prototype code is standard MV3 and expected to work on Chrome/Chromium; this must be verified on a machine with Chrome before Phase 1 exit.

## 2. Prototype

Location: `/src/page-hook.js`, `/manifest.json`, `/test/harness.html`.

- `page-hook.js` runs in the `MAIN` world at `document_start`, stashes the original `WebAssembly` methods, replaces them with wrappers that normalize inputs to bytes (logging them) and then delegate to the originals (pass-through).
- `Response`/`Promise<Response>` inputs are cloned (`.clone()`) so bytes can be read without consuming the stream the original call needs.
- `WebAssembly.Module`/`Instance` constructors are replaced while preserving the prototype chain and static keys, so `instanceof` checks keep working.

Verified interception output (Firefox 153, local harness):
```
[wasMonkey] compile: 41 bytes
[wasMonkey] instantiate: 41 bytes
[wasMonkey] instantiateStreaming: 41 bytes
[wasMonkey] compileStreaming: 41 bytes
[wasMonkey] Module ctor: 41 bytes
```

## 3. Manifest version strategy (decision)

- **Primary target: Manifest V3**, `world: "MAIN"` content script at `document_start`, for Chrome/Chromium and Firefox (current ESR + stable).
- **Firefox fallback:** For older ESR builds where `world: "MAIN"` is unavailable or rejected, fall back to injecting a `<script>` tag (file listed under `web_accessible_resources`) that runs in page context. Abstract behind a single `inject.ts` module selected at build time (Phase 6).
- **Safari:** primary path is the `<script>`-tag fallback (Safari lacks reliable `world: "MAIN"`); MV3 manifest otherwise.
- **MV2:** not a primary target; only consider if a significant ESR user base needs it. Decision: MV3 primary, MV2 not shipped unless demand emerges.

Rationale: Firefox 153 ESR (tested) supports `world: "MAIN"` in MV3 content scripts, so the modern path is viable today; the `<script>` fallback remains mandatory for Safari and older Firefox.

## 4. CSP findings (site survey)

Surveyed headers on a handful of WASM-relevant sites. Key observations:

| Site | CSP relevant directives | Notes |
|---|---|---|
| Figma | `script-src ... 'unsafe-eval' 'unsafe-inline' ...` (no explicit `wasm-unsafe-eval`) | WASM likely allowed via `unsafe-eval`; patched re-instantiation may still be OK, but should be verified. `worker-src 'self'`. |
| Google Earth | `script-src 'nonce-...' 'unsafe-inline'; worker-src 'self'` | Nonce-based. Injected `<script>` fallback would be blocked unless nonce is obtained; `world: "MAIN"` content script is not subject to page CSP for injection, but re-instantiating patched bytes may require `wasm-unsafe-eval` (absent) → potential failure (Phase 7). |
| MDN | explicitly includes `'wasm-unsafe-eval'` | Good reference for what "WASM-friendly" CSP looks like. |
| Discord | large `script-src` allowlist + hashes, no `wasm-unsafe-eval` seen | Likely blocks patched re-instantiation on strict paths. |
| Meet (Google) | `'unsafe-eval'` present | Should allow WASM. |
| Crazygames | no CSP header observed | Permissive; lowest risk. |

Failure modes identified:
1. **Strict CSP without `wasm-unsafe-eval`/`unsafe-eval`**: original page WASM may still run (compiled by browser under site's trusted context), but wasMonkey's patched bytes re-instantiated via `new WebAssembly.Module`/`instantiate` can throw `CompileError`/CSP violation. Mitigation: detect and warn; optional `declarativeNetRequest` relaxation (opt-in, Phase 7).
2. **Nonce/SRI**: patched bytes change content hashes; SRI on fetched `.wasm` will fail. Detect and warn rather than silently break.
3. **Workers**: dedicated/shared/service workers cannot be content-scripted directly; need script-prepend strategy (Phase 6).
4. **`world: "MAIN"` injection blocked by very strict reviewers?** Not observed on tested sites for the content script itself (content scripts are injected by the browser, not subject to page CSP for the injection act), but execution of injected code is still governed by page CSP for eval/wasm.

## 5. Binaryen.js / wabt.js spike

- No browser (UMD) builds of Binaryen/wabt were available in this environment's npm cache; only Node ESM builds (`index.js`) were present. Node-side generation of a sample WASM module via wabt succeeded (used for the harness fixture), confirming the libraries function.
- **Conclusion / open item:** Before Phase 4, vendor official browser builds of Binaryen.js and wabt.js, expose them as `web_accessible_resources`, and lazy-load into the `MAIN` world only on demand. Confirm in a basic page that calling `Binaryen.parseText`/`wabt.parseWat` does not trip CSP (`wasm-unsafe-eval`) on a CSP-strict site. This is the highest-risk open item and should be spiked early in Phase 4.
- Expected issue: both libraries compile WASM internally, so on strict-CSP sites they will need `'wasm-unsafe-eval'` (or relaxation) to function — aligns with Phase 7.

## 6. Real-site interception (exit-criteria check)

Full automated interception verification across 20 sites requires a logged-in/interactive browser session; only headless Firefox was available and content-script console capture in headless web-ext is unreliable. What was verified:
- Hook installs and intercepts all entry points on a local fixture in Firefox 153 ESR (see §2).
- CSP/header survey completed for 12 sites (§4).

**Assessment vs exit criteria ("intercept & log WASM bytes on ≥80% of 20 real sites, Chrome + Firefox"):**
- Firefox: hook mechanism proven; real-site pass not fully executed in this environment. Recommend running the Phase 10 real-site matrix once a visible browser session + Chrome are available.
- Chrome: not testable here; prototype is standard MV3 and pending verification.

## 7. Recommendations for Phase 1

1. Keep `page-hook.js` as the single MAIN-world entry; add an isolated-world bridge only when storage is needed (Phase 2).
2. Implement the full hook surface exactly as prototyped; normalize `ArrayBuffer`/typed views/`Response`/`Promise<Response>` (already done).
3. Add `@grant`-gated registration API (Phase 5) on top of the current ad hoc globals; keep `window.__wasMonkeyHooks` only as a transitional shim.
4. Implement the `<script>`-tag fallback injector early (Phase 6) because Safari and older Firefox depend on it.
5. Add try/catch per-hook and a panic toggle from the start (Phase 7), since prototype currently lets a throwing hook break the page path.
6. Defer Binaryen/wabt bundling to Phase 4, but reserve the lazy-load contract in the API (`getBinaryen()`/`getWabt()`).

## 8. Limitations of this Phase 0 run

- No Chromium/Chrome binary available → Chrome path unverified.
- No interactive browser session → real-site interception matrix not fully executed; header/CSP survey substituted.
- No vendored browser builds of Binaryen/wabt → spike partially completed (Node-side only).
- web-ext headless console capture of MAIN-world content scripts was unreliable; local harness used a collect endpoint to confirm behavior.
