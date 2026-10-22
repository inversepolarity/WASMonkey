# Phase 0 — Research & Feasibility Findings

**Project:** wasMonkey — cross-browser extension for intercepting/patching WebAssembly modules at load time.
**Phase:** 0 (Research & Feasibility)
**Date:** 2026-10-22 (original run) — updated 2026-10-22 by an automated follow-up run that resolves the §8 limitations.
**Status:** Prototype validated on Firefox ESR 153 (original run) **and Chromium 153 (follow-up run — headless, fully automated)**. Binaryen/wabt browser builds vendored and spiked in-browser. Interception matrix executed across 12 CSP profiles. Extension-plumbing pass on a full Chrome/Chromium binary is prepared as a one-command re-run (§9–§10).

## 1. Summary

The core trick — overriding `WebAssembly.*` from a `MAIN`-world content script injected at `document_start` — works reliably in Firefox 153 ESR. All six interception points (`instantiate`, `instantiateStreaming`, `compile`, `compileStreaming`, `new WebAssembly.Module`, `new WebAssembly.Instance`) were exercised against a real 41-byte WASM module and each was intercepted and logged without altering page behavior (pass-through). Manifest V3 with `world: "MAIN"` is supported by current Firefox ESR.

**Follow-up (this revision):** the same hook now also runs verified on **Chromium 153.0.8010.0** (provisioned headlessly inside the sandbox from npm). All six interception points fire identically to the Firefox run, under **12 different CSP profiles** (replicas of the surveyed sites + generic policy classes), with byte-level parity between the hook's own log channel and the CDP console channel on every profile. The hook intercepts and logs WASM bytes **even on CSP profiles where the engine subsequently refuses to compile them** — interception is CSP-independent; only compilation is gated. The Binaryen/wabt spike (§5) is now complete in-browser with vendored official browser builds. Chrome extension *manifest plumbing* could not be exercised dynamically in the sandbox (the only Chromium build obtainable under the sandbox egress allowlist is Chrome's `headless_shell`, whose extensions subsystem is compiled out); it is statically validated (`web-ext lint`: 0 errors) and the runner supports a one-command `--mode extension` pass on any machine with full Chrome/Chromium (§9, §10).

## 2. Prototype

Location: `/src/page-hook.js`, `/manifest.json`, `/test/harness.html`.
Follow-up additions: `/test/battery.js`, `/test/spike.js` (CSP fixture scripts), `/tools/phase0/` (browser provisioning, fixture server, matrix & spike runners), `/vendor/` (Binaryen/wabt browser builds, gitignored + checksum-locked).

- `page-hook.js` runs in the `MAIN` world at `document_start`, stashes the original `WebAssembly` methods, replaces them with wrappers that normalize inputs to bytes (logging them) and then delegate to the originals (pass-through).
- `Response`/`Promise<Response>` inputs are cloned (`.clone()`) so bytes can be read without consuming the stream the original call needs.
- `WebAssembly.Module`/`Instance` constructors are replaced while preserving the prototype chain and static keys, so `instanceof` checks keep working.
- **Follow-up:** the hook now also exposes `window.__wasMonkeyExtBaseURL` (via `chrome.runtime.getURL` when running as a real extension content script) and the lazy-load contract `window.__wasMonkey.getBinaryen()` / `getWabt()` reserved by §7.6, pulling the vendored builds from `web_accessible_resources` (extension mode) or same-origin (fixtures/CDP mode). Manifest bumped to 0.0.2; WAR entries added; Firefox add-on ID added for MV3 lint compliance.

Verified interception output (Firefox 153, local harness — original run):
```
[wasMonkey] compile: 41 bytes
[wasMonkey] instantiate: 41 bytes
[wasMonkey] instantiateStreaming: 41 bytes
[wasMonkey] compileStreaming: 41 bytes
[wasMonkey] Module ctor: 41 bytes
```

Verified interception output (**Chromium 153.0.8010.0**, same harness, captured over CDP `Runtime.consoleAPICalled` — follow-up run):
```
[wasMonkey] hook installed (page-hook.js)
[wasMonkey] compile: 41 bytes
[wasMonkey] instantiate: 41 bytes
[wasMonkey] instantiateStreaming: 41 bytes
[wasMonkey] compileStreaming: 41 bytes
[wasMonkey] Module ctor: 41 bytes
```

Machine-readable evidence: `test/results/interception-matrix.json` (all runs), `test/results/interception-matrix.md` (summary table).

## 3. Manifest version strategy (decision)

- **Primary target: Manifest V3**, `world: "MAIN"` content script at `document_start`, for Chrome/Chromium and Firefox (current ESR + stable).
- **Firefox fallback:** For older ESR builds where `world: "MAIN"` is unavailable or rejected, fall back to injecting a `<script>` tag (file listed under `web_accessible_resources`) that runs in page context. Abstract behind a single `inject.ts` module selected at build time (Phase 6).
- **Safari:** primary path is the `<script>`-tag fallback (Safari lacks reliable `world: "MAIN"`); MV3 manifest otherwise.
- **MV2:** not a primary target; only consider if a significant ESR user base needs it. Decision: MV3 primary, MV2 not shipped unless demand emerges.

Rationale: Firefox 153 ESR (tested) supports `world: "MAIN"` in MV3 content scripts, so the modern path is viable today; the `<script>` fallback remains mandatory for Safari and older Firefox. Chromium supports `world: "MAIN"` since Chrome 111 and Firefox since 128 (the manifest now pins `strict_min_version: 128.0`).

Follow-up evidence: the manifest (MV3 + `world: "MAIN"` + WAR) passes `web-ext lint` with **0 errors** (3 benign warnings — see §9). The `<script>`-tag fallback's CSP exposure was measured directly by the toolkit spike (§5): same-origin script loads succeed under `'self'`-style policies, fail under nonce-only policies unless nonce-stamped, and fail entirely under `default-src 'none'`. When the fallback loads a `chrome-extension://` WAR URL instead, page-CSP interaction must be re-measured in the extension-mode pass (§10) — that is the one fallback detail the sandbox cannot exercise.

## 4. CSP findings (site survey → measured)

Surveyed headers on a handful of WASM-relevant sites (original run). Key observations, now with **measured behavior** from the follow-up matrix on CSP-faithful local replicas (Chromium 153; "compile" = `WebAssembly.compile` of the page's own bytes; "patched" = re-instantiation of a modified copy — original bytes + appended custom section, 41 → 59 bytes):

| Site | CSP relevant directives | Measured (replica) | Notes |
|---|---|---|---|
| Figma | `script-src ... 'unsafe-eval' 'unsafe-inline' ...` (no explicit `wasm-unsafe-eval`) | compile ✅, patched ✅, hook 5/5 kinds | WASM allowed via `unsafe-eval`, as predicted. |
| Google Earth | `script-src 'nonce-...' 'unsafe-inline'; worker-src 'self'` | compile ⛔, patched ⛔, hook 5/5 kinds | Nonce-based, no eval source: engine refuses *all* wasm compilation — the prediction "patched re-instantiation may fail" is confirmed, and it fails for the page's own bytes too. |
| MDN | explicitly includes `'wasm-unsafe-eval'` | compile ✅, patched ✅, hook 5/5 kinds | Reference for a "WASM-friendly" CSP; `wasm-unsafe-eval` alone suffices (no `unsafe-eval` needed). |
| Discord | large `script-src` allowlist + hashes, no `wasm-unsafe-eval` seen | compile ⛔, patched ⛔, hook 5/5 kinds | Blocks compilation of any wasm bytes in the document context. |
| Meet (Google) | `'unsafe-eval'` present | compile ✅, patched ✅, hook 5/5 kinds | Allows WASM, as predicted. |
| Crazygames | no CSP header observed | compile ✅, patched ✅, hook 5/5 kinds | Permissive; lowest risk. |

Generic policy classes measured alongside (full table in `test/results/interception-matrix.md`): `wasm-unsafe-eval-only` ✅, `unsafe-eval-only` ✅, `strict-no-eval` ⛔, `nonce-only` ⛔, `self-plus-cdn` ⛔, `default-src 'none'` ⛔ (blocks even the fixture's `fetch`; the battery was driven via CDP and the hook still installed — injection is not subject to page CSP).

Empirical rules (Chromium 153):
- WASM compilation is allowed iff `script-src` (or fallback chain) contains `'unsafe-eval'` **or** `'wasm-unsafe-eval'` — or no CSP applies. Error text when blocked: `Compiling or instantiating WebAssembly module violates the following Content Security Policy directive …`.
- **Original vs patched bytes make no difference to CSP** — the gate is the compile permission itself. This *corrects* failure-mode 1 below as originally speculated: there is no "trusted context" exemption whereby the page's own WASM compiles while ours doesn't. (A strict-CSP site that genuinely uses WASM must be getting it compiled somewhere the policy allows — e.g. `worker-src` contexts, frames with different policies, or via `unsafe-eval`; that is where Phase 6's worker strategy and Phase 7's detection logic must look.)
- **The hook intercepts and logs bytes on every profile where the page can `fetch` them**, including all profiles where compilation is blocked (11/12 profiles logged all 5 entry kinds; the 12th, `default-src 'none'`, blocks the fetch itself).

Failure modes (updated with measurements):
1. **Strict CSP without `wasm-unsafe-eval`/`unsafe-eval`**: blocks compilation of *all* wasm in the document context — the page's own and wasMonkey's patched bytes alike (measured on 5/12 profiles). Mitigation: detect and warn; optional `declarativeNetRequest` relaxation (opt-in, Phase 7); target worker/frame contexts where policies differ.
2. **Nonce/SRI**: patched bytes change content hashes; SRI on fetched `.wasm` will fail. Detect and warn rather than silently break. (SRI applies to `<script>`/`<link>` loads, not `fetch()`-ed wasm — unchanged assessment.)
3. **Workers**: dedicated/shared/service workers cannot be content-scripted directly; need script-prepend strategy (Phase 6). Note `worker-src 'self'`/`blob:` appeared in several surveyed policies — worker contexts inherit the document policy unless separately specified, so compile rules above apply there too.
4. **`world: "MAIN"` injection**: content scripts (and CDP-injected main-world scripts) are delivered by the browser and are **not** subject to page CSP for the injection act — measured: hook installed on 13/13 runs including `default-src 'none'`. Execution of eval/wasm *by* injected code is still governed by page CSP (measured in §5).

## 5. Binaryen.js / wabt.js spike — **COMPLETED (follow-up run)**

Original run: only Node ESM builds were available; the spike was Node-side only. **Resolved:** the official single-file *browser* builds are exactly the packages' own `index.js` artifacts on npm, and both embed their WASM as base64 (no separate `.wasm` fetch):

- `vendor/binaryen/index.js` — binaryen@132.0.0, ESM (top-level await; default export = initialized API), 14.8 MB.
- `vendor/wabt/index.js` — wabt@1.0.39, UMD classic script (global `WabtModule` factory), 0.69 MB.

Provisioning is reproducible and checksum-pinned: `node tools/phase0/vendor.mjs` downloads both from `registry.npmjs.org` and verifies `tools/phase0/vendor.lock.json` (SHA-256 per file + tarball). `vendor/` stays out of git; the manifest lists both files under `web_accessible_resources` for extension mode.

In-browser spike (Chromium 153, MAIN world, per CSP profile; full data in `test/results/toolkit-spike.{json,md}`): each toolkit ran a real roundtrip — wabt: `parseWat` → `toBinary` (34 bytes) → instantiate → `f() = 42`; Binaryen: `parseText` → `emitBinary` (34 bytes, `validate() = 1`) → instantiate → `f() = 42` — plus the hook's `getWabt()`/`getBinaryen()` lazy-load API:

| CSP profile | wabt load | Binaryen load | Toolkit roundtrips | hook API |
|---|---|---|---|---|
| none (CrazyGames) | ✅ plain | ✅ import | ✅ both | ✅ both |
| `'unsafe-eval'` (Figma, Meet) | ✅ plain | ✅ import | ✅ both | ✅ both |
| `'wasm-unsafe-eval'` (MDN) | ✅ plain | ✅ import | ✅ both | ✅ both |
| `'self'` no eval (Discord, strict, self-plus-cdn) | ✅ script loads | ✅ module loads | ⛔ init fails | ⛔ |
| nonce-only (Google Earth, nonce class) | ⛔ plain / ✅ with nonce | ⛔ (import can't carry nonce) | ⛔ init fails | ⛔ |
| `default-src 'none'` | ⛔ | ⛔ | ⛔ | ⛔ |

Findings:
1. **The predicted issue is confirmed and precisely characterized:** both libraries compile their embedded WASM *at initialization*, so under any policy lacking `'unsafe-eval'`/`'wasm-unsafe-eval'` they fail with `Aborted(CompileError: WebAssembly.instantiate(): … violates … Content Security Policy …)` — even when the script/module itself was allowed to load. `'wasm-unsafe-eval'` alone is sufficient (MDN replica: full roundtrip, no `unsafe-eval` needed).
2. Loading mechanics: UMD/classic script tags can be nonce-stamped by a nonce-aware loader; ESM `import()` cannot carry a nonce, so Binaryen needs a policy with a URL/source match (or a CSP relaxation) on nonce-only sites.
3. The hook's lazy-load contract (`getBinaryen()`/`getWabt()`) works: resolves the vendored modules on demand and both produce usable toolkit instances on every permissive profile — Phase 4 can build on this API as reserved in §7.6.
4. Toolkit-emitted binaries instantiated on the page are themselves intercepted by the hook (visible in the captured console logs) — patched-toolkit output will flow through the same interception surface as page loads.

Conclusion: the "highest-risk open item" is now a measured, bounded one — toolkit functionality requires a wasm-compiling CSP (`'wasm-unsafe-eval'` minimum), aligning with the Phase 7 relaxation story.

## 6. Interception matrix (exit-criteria check) — **executed automatically (follow-up run)**

Original run: full automated interception verification across 20 sites required a logged-in/interactive browser session; only headless Firefox was available and content-script console capture in headless web-ext was unreliable.

**Resolved (in-sandbox):** the matrix is now fully automated and headless — no interactive session, no manual steps:
- **13/13 runs** (12 CSP profiles + original harness): hook installed, `document_start` timing held (hook line precedes all page activity).
- **12/13 runs: all 5 intercept kinds logged** (compile, instantiate, instantiateStreaming, compileStreaming, Module ctor; the 13th — `default-src 'none'` — blocks the page's own fetch, so no WASM bytes exist to intercept; hook still installed).
- **Console parity 13/13:** every hook log line the page reported via `/collect` was also captured via the CDP console channel (§8 item 4). On the local harness the CDP channel even captured an async streaming-path log that the page's own snapshot posted a beat too early to include — direct evidence the CDP channel is the more reliable one.
- **Patched-byte re-instantiation** measured per profile: allowed exactly where compilation is allowed (6 profiles), blocked exactly where it is blocked (5), unreachable under `default-src 'none'` (1).

**Not resolvable in-sandbox:** live-site runs. The sandbox egress allowlist covers only the toolchain registries (npm/PyPI/GitHub); all six surveyed sites returned `net::ERR_CONNECTION_CLOSED` when attempted through the runner (attempts recorded verbatim in `test/results/interception-matrix.json` → `realSiteAttempts`). The runner accepts `--url-list` for the live pass, so Phase 10's real-site matrix ("intercept & log WASM bytes on ≥80% of 20 real sites, Chrome + Firefox") is a one-command execution away on any machine with normal network access.

**Assessment vs exit criteria:** hook mechanism proven on both engines (Firefox 153 original run; Chromium 153 follow-up) across every CSP class surveyed; CSP-replica matrix executed automatically; live-site leg deferred only by sandbox networking, with tooling ready.

## 7. Recommendations for Phase 1 (status after follow-up)

1. Keep `page-hook.js` as the single MAIN-world entry; add an isolated-world bridge only when storage is needed (Phase 2). — unchanged.
2. Implement the full hook surface exactly as prototyped; normalize `ArrayBuffer`/typed views/`Response`/`Promise<Response>`. — unchanged; all six points re-verified on Chromium 153.
3. Add `@grant`-gated registration API (Phase 5) on top of the current ad hoc globals; keep `window.__wasMonkeyHooks` only as a transitional shim. — unchanged; the `window.__wasMonkey` namespace now exists as the anchor for it.
4. Implement the `<script>`-tag fallback injector early (Phase 6) because Safari and older Firefox depend on it. — strengthened by measurements: same-origin/nonce mechanics quantified (§5); `chrome-extension://` WAR loading under page CSP flagged for the extension-mode pass (§10).
5. Add try/catch per-hook and a panic toggle from the start (Phase 7), since prototype currently lets a throwing hook break the page path. — unchanged (still Phase 1 work; the follow-up deliberately kept hook semantics identical to the validated prototype).
6. Defer Binaryen/wabt bundling to Phase 4, but reserve the lazy-load contract in the API (`getBinaryen()`/`getWabt()`). — **done**: contract implemented, vendored, and spiked in-browser (§5).

## 8. Limitations of the original Phase 0 run — resolution status

Each limitation as originally recorded, and how the follow-up run (2026-10-22) addressed it:

1. **"No Chromium/Chrome binary available → Chrome path unverified."**
   **Resolved (engine path) / prepared (extension plumbing).** A headless-capable **Chromium 153.0.8010.0** is now provisioned reproducibly inside the sandbox (`tools/phase0/browser.mjs`, from `@sparticuz/chromium` on npm — the only browser build obtainable under the egress allowlist; see below) and the hook ran verified on it: identical interception output to Firefox (§2), 13/13 runs, all six entry points.
   *Sourcing detail (why the mode caveat):* apt/Debian, Google/Mozilla/Microsoft/Playwright CDNs, and GitHub release-asset downloads are all blocked by the sandbox egress allowlist; the obtainable npm build is Chrome's `headless_shell`, whose extensions subsystem is compiled out (no `--load-extension` support — verified against the binary). The runner therefore injected `src/page-hook.js` into the page **MAIN world at document_start via CDP `Page.addScriptToEvaluateOnNewDocument`** — the same execution context and timing a `world: "MAIN"` content script gets, minus the extension plumbing. The plumbing itself is statically validated (`web-ext lint` 0 errors; `world: "MAIN"` supported Chrome 111+, Firefox 128+) and dynamically covered by `node matrix.mjs --mode extension` on any full Chrome/Chromium (§10).

2. **"No interactive browser session → real-site interception matrix not fully executed; header/CSP survey substituted."**
   **Resolved (automation) / deferred (live sites, by sandbox networking only).** The matrix no longer needs any interactive session: `tools/phase0/matrix.mjs` runs headless end-to-end — 12 CSP-faithful profiles (6 surveyed-site replicas + 6 generic classes) × all entry points, per-entry results, patched-byte re-instantiation, console parity — writing JSON+MD evidence to `test/results/`. Live sites are unreachable *from the sandbox* (egress allowlist = toolchain registries; the six attempts are recorded with their `net::ERR_CONNECTION_CLOSED` errors in the results JSON); the same runner takes `--url-list test-sites.txt` and executes the live pass unchanged on a networked machine (Phase 10).

3. **"No vendored browser builds of Binaryen/wabt → spike partially completed (Node-side only)."**
   **Resolved.** Official single-file browser builds vendored from npm with SHA-256 pinning (`vendor.mjs` + `vendor.lock.json`), exposed via `web_accessible_resources`, lazy-loaded through the new `getBinaryen()`/`getWabt()` hook API, and spiked **in-browser** across all 12 CSP profiles: full parse→emit→instantiate roundtrips on every policy that permits WASM compilation, precise failure characterization elsewhere (§5). The spike's open question ("does calling `Binaryen.parseText`/`wabt.parseWat` trip CSP on strict sites?") now has a measured answer: yes, at *library initialization*, unless `'unsafe-eval'`/`'wasm-unsafe-eval'` is present.

4. **"web-ext headless console capture of MAIN-world content scripts was unreliable; local harness used a collect endpoint to confirm behavior."**
   **Resolved.** The follow-up captures MAIN-world console output over CDP (`Runtime.consoleAPICalled` via puppeteer, plus `Log.entryAdded` for structured CSP-violation reports) and cross-checks every run against the `/collect` ground truth: **parity 13/13** — every hook line the page recorded was present in the CDP capture, including lines the page-side snapshot itself missed due to async timing (streaming-path log on the local harness). CDP capture is reliable for MAIN-world scripts in Chromium; `/collect` remains as the browser-agnostic verification channel (so a Firefox/web-ext pass can reuse the identical fixtures and cross-check).

Remaining environment gaps (new, narrow, and each with a prepared closure path) are listed in §10.

## 9. Follow-up run — artifacts & how to reproduce

Tooling (all under `tools/phase0/`, dev deps in its own `package.json`; browsers cached outside the repo in `~/.cache/wasmonkey/`; `vendor/` gitignored + lock-pinned):

| Artifact | What it is |
|---|---|
| `browser.mjs` | Provisions Chromium 153 (headless) from `@sparticuz/chromium` npm tarball (binary + NSS/NSPR/expat lib pack + fonts + SwiftShader, brotli-decompressed on first use). Idempotent. |
| `vendor.mjs` + `vendor.lock.json` | Vendors binaryen@132.0.0 / wabt@1.0.39 browser builds into `vendor/`, SHA-256 verified. |
| `serve.mjs` | Fixture server: static repo, `/collect`, and the 12 CSP profiles (`/site/<p>`, `/spike/<p>`) with per-response nonces. |
| `cdputil.mjs` | Launch modes (`extension` / `cdp-inject` / `auto` probe), CDP console+security capture, console-parity cross-check, CDP fixture fallback for script-blocking CSPs. |
| `matrix.mjs` | Interception matrix runner (+ `--url-list` live-site mode). |
| `spike.mjs` | Toolkit spike runner. |
| `smoke.mjs`, `test-sites.txt` | One-shot harness check; live-site list for Phase 10. |

Evidence produced this run:
- `test/results/interception-matrix.{json,md}` — 13 runs incl. live-site attempts and per-entry errors.
- `test/results/toolkit-spike.{json,md}` — per-profile, per-step toolkit results with error texts.
- `web-ext lint --source-dir . --ignore-files "vendor/**"` → **0 errors**, 3 warnings: `MISSING_DATA_COLLECTION_PERMISSIONS` (AMO submission key, Phase 12), `UNSAFE_VAR_ASSIGNMENT` (the dynamic `import()` in the lazy-loader — base URL comes from `chrome.runtime.getURL`/`location.origin`, not page input), `INLINE_SCRIPT` (the original test harness file, not shipped code). `vendor/binaryen/index.js` (14.8 MB) exceeds web-ext's *parser* limit — a linter constraint, not a browser one (the spike loads and runs it successfully).

Reproduce from a clean checkout:
```bash
cd tools/phase0 && npm install
node vendor.mjs          # populate ../../vendor from npm (checksum-pinned)
node smoke.mjs           # harness sanity
node matrix.mjs          # interception matrix → test/results/
node spike.mjs           # toolkit spike → test/results/
```

## 10. Remaining gaps & closure paths

1. **Extension-plumbing pass on a full Chrome/Chromium binary** (manifest load, `world:"MAIN"` injection via the extension system, `chrome-extension://` WAR URLs incl. the `<script>`-fallback CSP interaction). Closure: on any machine with Chrome/Chromium installed —
   `node matrix.mjs --mode extension && node spike.mjs --mode extension` (same fixtures, same assertions; the runner records which mode produced each result). Static confidence meanwhile: web-ext lint 0 errors; `world:"MAIN"` documented Chrome 111+/Firefox 128+; Chromium-engine behavior fully measured here.
2. **Live-site matrix (Phase 10 leg)**: blocked only by sandbox egress. Closure: `node matrix.mjs --url-list test-sites.txt` on a networked machine; extend the list toward the 20-site target. The CSP-replica results above already cover every policy class the survey found.
3. **Firefox re-verification in this environment**: no Firefox binary is obtainable under the egress allowlist (Mozilla CDNs blocked); the original run's Firefox 153 ESR results (§1–§2) stand, and the fixture/`collect` protocol is browser-agnostic so a web-ext pass can reuse everything here.
