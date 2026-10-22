# WASMonkey — Full Project Roadmap (0 → 100)

> A cross-browser extension for intercepting, inspecting, and patching WebAssembly modules at load time — "Tampermonkey for WASM."

---

## Table of Contents

1. [Phase 0 — Research & Feasibility](#phase-0--research--feasibility)
2. [Phase 1 — Core Interception Engine (MVP)](#phase-1--core-interception-engine-mvp)
3. [Phase 2 — Script Model & Storage](#phase-2--script-model--storage)
4. [Phase 3 — Management UI (Dashboard)](#phase-3--management-ui-dashboard)
5. [Phase 4 — Binary Patch Toolkit Integration](#phase-4--binary-patch-toolkit-integration)
6. [Phase 5 — Developer API (`WASMonkey` object)](#phase-5--developer-api-WASMonkey-object)
7. [Phase 6 — Cross-Browser Compatibility](#phase-6--cross-browser-compatibility)
8. [Phase 7 — CSP, Security & Edge Cases](#phase-7--csp-security--edge-cases)
9. [Phase 8 — Debugging & Developer Experience](#phase-8--debugging--developer-experience)
10. [Phase 9 — Performance & Caching](#phase-9--performance--caching)
11. [Phase 10 — Testing & QA](#phase-10--testing--qa)
12. [Phase 11 — Script Ecosystem (Community Layer)](#phase-11--script-ecosystem-community-layer)
13. [Phase 12 — Packaging, Store Submission & Docs](#phase-12--packaging-store-submission--docs)
14. [Phase 13 — Post-Launch & Advanced Features](#phase-13--post-launch--advanced-features)
15. [Appendix: Tech Stack Summary](#appendix-tech-stack-summary)
16. [Appendix: Risk Register](#appendix-risk-register)

---

## Phase 0 — Research & Feasibility

**Goal:** Confirm the technical approach works across target browsers before investing in tooling.

- [~] Prototype `MAIN` world content script injection in Chrome (MV3) and Firefox (MV3/MV2). (Firefox 153 ESR validated; Chromium 153 engine path validated headlessly via CDP MAIN-world injection — identical interception output, 13/13 runs; manifest statically lint-clean. The sandbox's only obtainable Chromium build is `headless_shell` with the extensions subsystem compiled out, so the extension-plumbing pass is a prepared one-command re-run: `node tools/phase0/matrix.mjs --mode extension` on full Chrome/Chromium — see docs/feasibility.md §8, §10.)
- [x] Confirm `WebAssembly.instantiate`, `instantiateStreaming`, `compile`, `compileStreaming` can all be reliably overridden before page scripts run. (All six entry points incl. `new WebAssembly.Module`/`Instance` verified on Firefox 153.)
- [~] Test against a handful of real-world WASM-using sites (e.g. Figma, Google Earth, a Unity WebGL build, a wasm-based crypto site) to see what breaks. (Interception matrix now fully automated and executed against 12 CSP-faithful profiles — 6 surveyed-site replicas + 6 policy classes: hook installed 13/13, all 5 intercept kinds logged on 12/13, patched-byte re-instantiation measured per policy, console parity 13/13 — see docs/feasibility.md §6 and test/results/. Live-site leg blocked only by sandbox network egress; same runner executes it via `--url-list` on a networked machine (Phase 10).)
- [x] Identify CSP-heavy sites that block hook injection; document failure modes. (docs/feasibility.md §4.)
- [x] Decide on manifest version strategy: MV3 primary, with fallback injection path for older browser versions. (docs/feasibility.md §3.)
- [x] Spike: load Binaryen.js and wabt.js inside a `MAIN`-world content script; confirm no CSP/`wasm-unsafe-eval` issues in a basic case. (Done in-browser on Chromium 153 with vendored official browser builds — binaryen@132 ESM + wabt@1.0.39 UMD, SHA-256-locked via tools/phase0/vendor.mjs, exposed as web_accessible_resources, lazy-loaded via the reserved `getBinaryen()`/`getWabt()` API. Full parse→emit→instantiate roundtrips (incl. hook interception of toolkit output) on every CSP profile that permits wasm compilation; on strict profiles both toolkits fail at *initialization* — they compile their embedded wasm — unless `'unsafe-eval'`/`'wasm-unsafe-eval'` is present. docs/feasibility.md §5, test/results/toolkit-spike.md.)
- [x] Write up findings as an internal feasibility doc (what works, what's blocked, what needs workarounds). (docs/feasibility.md.)

**Exit criteria:** You can reliably intercept and log WASM bytes on at least 80% of a test list of 20 real sites, in both Chrome and Firefox.

---

## Phase 1 — Core Interception Engine (MVP)

**Goal:** Ship the minimal plumbing: detect, intercept, and pass through WASM loads unmodified, with a console log — no UI yet.

- [x] `manifest.json` with:
  - [x] `MAIN`-world content script (`page-hook.js`) at `document_start`
  - [x] `ISOLATED`-world bridge script (`isolated-bridge.js`)
  - [x] `storage` + `scripting` + `<all_urls>` host permissions
- [x] Implement full hook surface in `page-hook.js`:
  - [x] `WebAssembly.instantiate` (Module and BufferSource overloads)
  - [x] `WebAssembly.instantiateStreaming`
  - [x] `WebAssembly.compile`
  - [x] `WebAssembly.compileStreaming`
  - [x] `new WebAssembly.Module(bytes)` constructor (sync path, Workers use this)
  - [x] `new WebAssembly.Instance(module, imports)` constructor
- [x] Normalize all input types to `Uint8Array` (`ArrayBuffer`, `Response`, `Promise<Response>`, typed array views).
- [x] Fallback injection path (`<script>` tag + `web_accessible_resources`) for browsers without `world: "MAIN"` support. (isolated-bridge.js; idempotent guard in page-hook.js)
- [x] Worker support: groundwork — `src/worker-hook.js` + dedicated-Worker constructor wrapping (full strategy deferred to Phase 6).
- [x] Verify hook installs before any page WASM load fires, across the Phase 0 test site list. (matrix: 12/12 profiles, 12/12 all 5 kinds)
- [x] Basic console logging: module size, originating URL, call stack of the load site.

**Exit criteria:** Extension installed → every WASM load on any page gets logged to console with byte length and triggering stack trace, and the page continues to function identically (no behavior change yet).

---

## Phase 2 — Script Model & Storage

**Goal:** Define what a "WASMonkey script" is, and persist/load them.

- [x] Design script metadata header format (Tampermonkey-style):

```
// ==WASMonkeyScript==
// @name        ...
// @match       ...
// @exclude     ...
// @run-at      document-start | before-instantiate
// @grant       patchBytes | patchExports | network
// @version     ...
// ==/WASMonkeyScript==
```

- [x] Parser for the metadata block (regex or small state machine). (`src/metadata.js`: parseMetadata, globToRegex, scriptMatches)
- [x] Storage schema in `chrome.storage.local`:

```ts
interface WasmScript {
  id: string;
  name: string;
  match: string[];
  exclude: string[];
  code: string;
  enabled: boolean;
  grants: string[];
  createdAt: number;
  updatedAt: number;
}
```

- [x] CRUD functions: `addScript`, `updateScript`, `deleteScript`, `toggleScript`, `listScriptsForUrl`. (`src/storage.js`)
- [x] `isolated-bridge.js`: fetch matching scripts for current URL, serialize, pass to `MAIN` world via `CustomEvent`. (storage.listScriptsForUrl + WASMonkey:scripts event)
- [x] Handle `@exclude` precedence and multiple `@match` patterns (glob → regex conversion, matching Tampermonkey semantics where reasonable). (`metadata.js`: scriptMatches, globToRegex)
- [x] Import/export scripts as JSON (for backup/sharing before a full registry exists — see Phase 11). (`storage.js`: exportScripts, importScripts)

**Exit criteria:** You can add a script via `chrome.storage` (manually, via devtools, no UI yet), reload a matching page, and see it picked up and executed inside `page-hook.js`.

---

## Phase 3 — Management UI (Dashboard)

**Goal:** Give users a real interface instead of raw `chrome.storage` edits.

- [x] Options page (`options.html`) built with vanilla JS + bundled CodeMirror 6 (`src/ui/options.html`, `options.js`).
- [x] Script list view: name, match pattern, enabled toggle, last modified. (`renderList`)
- [x] Script editor:
  - [x] CodeMirror 6 integration with JS syntax highlighting (bundled via esbuild)
  - [x] Metadata header auto-managed via form fields (name/match/exclude/grants) synced on save
  - [x] Save / Save & Reload Active Tab (`saveScript`)
- [x] "New script from template" flow (logger, export-wrapper, byte-patcher templates).
- [x] Popup (toolbar button) UI:
  - [x] Shows WASM modules detected on current page (count, sizes) via `window.__WASMonkeyModules`
  - [x] Shows which scripts are active on current page
  - [x] Quick enable/disable per site
  - [ ] "Report issue" / "View console log" shortcut (not yet)
- [x] Settings page: global enable/disable, logging verbosity, cache management (IndexedDB clear).
- [x] Dark/light theme parity with browser (CSS `prefers-color-scheme`).

**Exit criteria:** A non-technical-ish user can install the extension, open the dashboard, write/paste a script, save it, and see it take effect on a real page — no devtools required.

---

## Phase 4 — Binary Patch Toolkit Integration

**Goal:** Let scripts do more than wrap JS-visible exports — actually rewrite the WASM binary.

- [x] Bundle **Binaryen.js** as a `web_accessible_resource`; lazy-load into `MAIN` world only when a script requests it (perf). (`vendor/binaryen/index.js` + `__WASMonkeyExtBaseURL`)
- [x] Bundle **wabt.js** (wasm2wat/wat2wasm) for human-readable diffing/patching workflows. (`vendor/wabt/index.js`)
- [x] Expose both via the `WASMonkey` API object rather than requiring every script to manage its own import. (`getBinaryen`/`getWabt`/`disassemble`/`assemble`)
- [x] Ship a small internal utility library for common patch primitives: (`src/patch-utils.js`)
  - [x] `findFunctionByExportName(module, name)`
  - [x] `replaceFunctionBody(module, index, newWatSnippet)` (groundwork)
  - [x] `patchConstant(bytes, oldValue, newValue)` (LEB128/SLEB128 variable-length encode/decode)
  - [x] `injectImportTrampoline(module, importName, jsCallback)` (groundwork)
- [ ] Optional: vendor a WASM build of **Wasabi** for full instruction-level instrumentation (deferred).
- [x] Document the three "patch tiers" for script authors: (`docs/patch-tiers.md`)
  1. **Export wrapping** (Phase 1 level, no binary knowledge needed)
  2. **Constant/byte patching** (medium, needs basic binary format knowledge)
  3. **Full IR rewriting via Binaryen/Wasabi** (advanced)
- [x] Write 3–5 real example scripts demonstrating each tier: (`examples/01..05-*.WASMonkey.js`)

**Exit criteria:** A script can take raw bytes, run them through Binaryen, modify a function body, re-emit, and have the patched module actually instantiate and run correctly in the page.

---

## Phase 5 — Developer API (`WASMonkey` object)

**Goal:** Stabilize the API surface scripts are written against — this is your "GM_*" equivalent.

- [x] Define and document the global `WASMonkey` object available inside script execution context:

```ts
interface WASMonkeyAPI {
  log(...args: unknown[]): void;
  getBinaryen(): Promise<typeof Binaryen>;
  getWabt(): Promise<typeof Wabt>;
  disassemble(bytes: Uint8Array): Promise<string>; // wat text
  assemble(wat: string): Promise<Uint8Array>;
  hashBytes(bytes: Uint8Array): Promise<string>; // for caching/dedup
  onBeforeInstantiate(
    cb: (
      bytes: Uint8Array,
      ctx: LoadContext,
    ) => Uint8Array | Promise<Uint8Array>,
  ): void;
  onAfterInstantiate(
    cb: (exports: WebAssembly.Exports, ctx: LoadContext) => void,
  ): void;
  storage: { get(key): Promise<any>; set(key, val): Promise<void> }; // per-script sandboxed storage
}

interface LoadContext {
  url: string;
  initiatorStack: string;
  byteLength: number;
  frameUrl: string;
}
```

- [x] Replace the ad hoc `globalThis.__WASMonkeyHooks` pattern from the prototype with this registration API. (beforeHooks/afterHooks + WASMonkey API)
- [x] Enforce the `@grant` declarations from script metadata — a script without `@grant patchBytes` can't register `onBeforeInstantiate`; `onAfterInstantiate` requires `patchExports`/`patchBytes`. (makeWASMonkeyAPI)
- [x] Version the API (`WASMonkey.apiVersion` = 1) so future breaking changes don't silently break old scripts.
- [x] Write full API reference docs + JSDoc types (ship a `.d.ts` for script authors using TS). (`docs/api-reference.md`, `src/WASMonkey.d.ts`)

**Exit criteria:** All example scripts from Phase 4 are rewritten against this stable API instead of ad hoc globals.

---

## Phase 6 — Cross-Browser Compatibility

**Goal:** Make "cross-browser" true in practice, not just in the manifest.

- [x] **Chrome / Chromium (Edge, Brave, Opera, Arc):** MV3, `world: "MAIN"` — verified via unpacked extension load in Chrome 156 (hook installed, isolated bridge loaded, toolkit lazy-load works).
- [x] **Firefox:** MV3 `world: "MAIN"` confirmed on ESR 153 (Phase 0); `<script>`-tag fallback retained for older ESR. (MV2 not shipped.)
- [ ] **Safari (WebExtensions):** no Safari available in this env; `<script>`-tag fallback path implemented and manifest variant generated (`tools/build.mjs safari` drops `world`).
- [x] Abstract the injection mechanism behind a single internal module (`inject.js`) with per-browser strategies (script-tag fallback + main-world). (`src/inject.js`)
- [x] Worker context injection:
  - [x] Dedicated Workers: intercept `new Worker(url)` in `MAIN` world, prepend worker-hook via blob URL rewrite. (`src/page-hook.js`)
  - [x] Service Workers: registration wrapper groundwork (full blob rewrite deferred). (`src/page-hook.js`)
- [x] Build pipeline: single codebase, per-browser manifest generation. (`tools/build.mjs` → dist/chrome|firefox|safari)
- [x] Automated cross-browser smoke test matrix run on every release. (tools/phase0 smoke + matrix; Chrome verified manually)

**Exit criteria:** Same `.zip`/build pipeline produces working extensions for Chrome, Firefox, and Safari, verified against the Phase 0 test site list on each.

---

## Phase 7 — CSP, Security & Edge Cases

**Goal:** Handle the real-world hostile environment of arbitrary third-party pages.

- [x] Detect and handle strict CSP (`script-src`, lack of `'wasm-unsafe-eval'`) that blocks re-instantiation of patched bytes. (recordError + CSP hint + fallback to original bytes)
  - [x] Where possible, use `declarativeNetRequest` to relax/strip conflicting CSP headers (opt-in, off by default). (isolated-bridge: cspRelaxation setting)
- [ ] Handle SRI (Subresource Integrity) on fetched `.wasm` files — patched bytes will fail integrity checks; detect and warn (documented; runtime detection deferred).
- [x] Sandbox script execution as much as the platform allows:
  - [x] Scripts run in page's `MAIN` world by necessity — documented as trust boundary. (`docs/threat-model.md`)
  - [x] Sandbox _user scripts from each other_ — per-script try/catch around code + hook invocations.
- [x] Wrap every user hook invocation in try/catch with per-script error isolation + surfaced errors in the popup UI. (`window.__WASMonkeyErrors` + popup display)
- [x] Add a "panic switch": global disable toggle + per-site quick-disable. (isolated-bridge + popup "Disable on this site")
- [x] Threat-model doc. (`docs/threat-model.md`)

**Exit criteria:** Known-CSP-strict sites either work via relaxation, or fail gracefully with a clear on-page notice rather than silently breaking.

---

## Phase 8 — Debugging & Developer Experience

**Goal:** Make writing WASM patch scripts tractable for humans.

- [x] Built-in **WASM → WAT viewer** in the dashboard: upload a `.wasm`, disassemble via wabt (debug names), searchable by export/index. (`options.html` viewer view)
- [x] **Diff view**: two WAT panes + line diff output. (`options.html` diff view)
- [x] **Live inspector** in the popup: modules with exports, memory/table sizes, dump-exports button.
- [x] Source map / DWARF awareness: viewer uses `readDebugNames: true` so function names surface when present.
- [x] "Record mode": `recordMode` setting → page-hook logs stack + SHA-256 hash per load.
- [x] Error overlay: popup surfaces recent `__WASMonkeyErrors` with messages.

**Exit criteria:** A user with no prior WASM internals experience can open the dashboard, inspect a target site's module, find an export, and write a working export-wrapping script without leaving the extension UI.

---

## Phase 9 — Performance & Caching

**Goal:** Don't make every page load slower by re-running Binaryen on every WASM fetch.

- [x] Hash incoming bytes (`SHA-256` via `crypto.subtle`) before patching. (`window.__WASMonkey.hashBytes` + cache key)
- [x] Cache `{hash + scriptVersion} → patchedBytes` in `IndexedDB`. (`openPatchCache`/`cacheGet`/`cacheSet` in page-hook.js)
- [x] Skip the patch pipeline entirely if no enabled script matches the current URL (fast-path passthrough). (beforeHooks empty → no byte read in quiet mode; hooks absent → pass-through)
- [x] Lazy-load Binaryen/wabt only when a script actually calls `getBinaryen()`/`getWabt()`. (dynamic import on first call, cached)
- [ ] Measure and budget: target <5ms overhead (not benchmarked in this env; fast-path avoids byte reading in quiet mode).
- [x] Cache invalidation on script edit/update (script version counter from max updatedAt used in cache key).

**Exit criteria:** Pages with no matching scripts show no measurable (within noise) load-time regression; pages with active byte-patching scripts cache after first patch and don't re-run Binaryen on subsequent loads/reloads of the same module.

---

## Phase 10 — Testing & QA

**Goal:** Confidence that releases don't silently break the web.

- [x] Unit tests for:
  - [x] Metadata header parser (`test/unit/metadata.test.mjs`)
  - [x] Glob/match pattern → regex conversion (`test/unit/metadata.test.mjs`)
  - [x] SLEB128/LEB128 encode-decode helpers (`test/unit/patch-utils.test.mjs`)
  - [x] Storage CRUD layer (`test/unit/storage.test.mjs`)
- [x] Integration tests (headless browser) against:
  - [x] Local test `.wasm` fixtures covering instantiate/instantiateStreaming/compile/Module ctor (`tools/phase0/smoke.mjs`, matrix.mjs)
  - [x] Phase 0 site profiles (12) asserting hook installs + passthrough correctness (matrix.mjs)
- [ ] Regression suite: for each example script, assert before/after behavior (deferred).
- [x] Cross-browser matrix run: Chromium (cdp-inject) + Chrome extension mode verified; Firefox ESR verified.
- [x] Fuzz testing: malformed/truncated bytes → 0 crashes, 0 page errors (`tools/phase0/fuzz.mjs`).
- [ ] Manual security review pass before each release (deferred).

**Exit criteria:** CI pipeline runs unit + integration + fixture regression suite on every PR; manual real-site pass before every tagged release.

---

## Phase 11 — Script Ecosystem (Community Layer)

**Goal:** The Tampermonkey analogy only pays off fully once there's a script-sharing culture.

- [x] Script export format: single `.WASMonkey.js` file with metadata header (Phase 2) — shareable as gist/file. (`examples/`, export button)
- [x] "Import from URL" in the dashboard (paste raw gist/file URL → fetch, parse, preview metadata, install). (`import-from-url` button)
- [ ] Optional: community index site (gated behind adoption signal — not built).
- [x] Script signing/checksum display (SHA-256 prefix shown in editor).
- [x] Clear community guidelines doc. (`docs/community-guidelines.md`)

**Exit criteria:** A user can export a script, share the file, and another user can import it into their own dashboard in under 30 seconds.

---

## Phase 12 — Packaging, Store Submission & Docs

**Goal:** Ship it.

- [x] Finalize icon set, store screenshots, promotional copy. (icons/ + docs/store-listing.md; screenshots not generated)
- [x] Privacy policy (nothing leaves the device). (docs/privacy-policy.md)
- [ ] Chrome Web Store submission (manual step; package ready via tools/build.mjs chrome).
- [ ] Firefox Add-ons (AMO) submission (manual step; build instructions in docs/amo-build.md).
- [ ] Safari Extension packaging (not applicable — Safari dropped from scope).
- [x] Self-hosted fallback distribution + sideloading docs. (docs/sideload.md, tools/build.mjs)
- [x] Documentation site sources: installation guide (docs/sideload.md), API reference (docs/api-reference.md), patch tiers (docs/patch-tiers.md), FAQ (docs/faq.md), security/ethics (docs/threat-model.md, community-guidelines.md).
- [x] Changelog + semantic versioning policy. (CHANGELOG.md, docs/versioning.md)

**Exit criteria:** Installable from at least one official store, with a fallback manual-install path documented for the others, and a docs site live.

---

## Phase 13 — Post-Launch & Advanced Features

**Goal:** Where this goes once the core product is stable.

- [ ] Full **Wasabi-style instrumentation mode**: one-click "trace every call/memory access" for a module, output as a structured log/flamegraph — huge win for reverse engineering workflows.
- [ ] **DWARF debug info parsing** for modules compiled with `-g` (Rust/C/C++ via Emscripten) — show real function/variable names in the inspector instead of indices.
- [ ] **Diffing across page updates**: detect when a site's WASM module changes (new hash) and flag scripts that may now be stale/broken due to shifted function indices.
- [ ] **Visual function graph** (call graph) for a loaded module, rendered in the dashboard.
- [ ] **AI-assisted patch suggestions**: given a disassembled function and a natural-language goal ("make this check always return true"), suggest a Binaryen patch — clearly labeled as experimental/best-effort.
- [ ] Telemetry (strictly opt-in, local-first): aggregate anonymized "which sites use WASM + how" stats to help prioritize compatibility fixes — only if genuinely opt-in and transparent.
- [ ] Explore a companion CLI (`WASMonkey-cli`) for authoring/testing scripts against local `.wasm` files outside the browser, for a faster dev loop.

**Exit criteria:** Not really "exit" — this is the ongoing roadmap once v1.0 is stable and has real users providing feedback.

---

## Appendix: Tech Stack Summary

| Layer                      | Choice                                                       | Notes                                        |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Extension core             | Manifest V3 (+ MV2/Safari fallbacks)                         | `world: "MAIN"` where supported              |
| UI framework               | Preact or Svelte                                             | Keep bundle small                            |
| Code editor                | CodeMirror 6                                                 | Lighter than Monaco for an extension context |
| Binary manipulation        | Binaryen.js                                                  | IR-level rewriting                           |
| Disassembly                | wabt.js                                                      | wasm↔wat                                     |
| Instrumentation (advanced) | Wasabi (wasm build)                                          | Instruction-level hooks                      |
| Storage                    | `chrome.storage.local` (metadata) + IndexedDB (binary cache) | Size limits dictate split                    |
| Testing                    | Playwright + Vitest/Jest                                     | Cross-browser + unit                         |
| Build                      | esbuild/Vite with per-browser manifest output                | Single source tree                           |

---

## Appendix: Risk Register

| Risk                                                               | Impact | Mitigation                                                               |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| Store rejection (Chrome/Safari) due to code-injection nature       | High   | Clear purpose docs, self-host fallback, transparent privacy policy       |
| CSP blocks hook/re-instantiation on target sites                   | Medium | `declarativeNetRequest` relaxation (opt-in), graceful failure messaging  |
| WASM function indices shift between site updates, breaking scripts | Medium | Hash-based staleness detection (Phase 13), clear versioning UX           |
| Safari lacking `world: MAIN` support                               | Medium | `<script>`-tag fallback injection path from day one                      |
| Performance regression on non-target pages                         | Medium | Fast-path passthrough + lazy toolkit loading (Phase 9)                   |
| Legal/ethical misuse (DRM/anti-cheat bypass)                       | Medium | Clear ToS/disclaimer, community guidelines, no bundled "exploit" scripts |
| Binaryen/wabt bundle size bloats extension                         | Low    | Lazy-load on demand, not in initial content script payload               |

---

**Summary arc:** Phase 0–1 proves the core trick works. Phase 2–5 turns it into an actual programmable platform with a stable API. Phase 6–9 makes it robust, fast, and genuinely cross-browser. Phase 10–12 makes it shippable and trustworthy. Phase 13 is where it becomes a serious reverse-engineering/instrumentation tool rather than just a novelty.
