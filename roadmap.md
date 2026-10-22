# wasMonkey — Full Project Roadmap (0 → 100)

> A cross-browser extension for intercepting, inspecting, and patching WebAssembly modules at load time — "Tampermonkey for WASM."

---

## Table of Contents

1. [Phase 0 — Research & Feasibility](#phase-0--research--feasibility)
2. [Phase 1 — Core Interception Engine (MVP)](#phase-1--core-interception-engine-mvp)
3. [Phase 2 — Script Model & Storage](#phase-2--script-model--storage)
4. [Phase 3 — Management UI (Dashboard)](#phase-3--management-ui-dashboard)
5. [Phase 4 — Binary Patch Toolkit Integration](#phase-4--binary-patch-toolkit-integration)
6. [Phase 5 — Developer API (`wasMonkey` object)](#phase-5--developer-api-wasmonkey-object)
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

- [~] Prototype `MAIN` world content script injection in Chrome (MV3) and Firefox (MV3/MV2). (Firefox 153 ESR validated; Chrome not available in this env — code is standard MV3, pending verification.)
- [x] Confirm `WebAssembly.instantiate`, `instantiateStreaming`, `compile`, `compileStreaming` can all be reliably overridden before page scripts run. (All six entry points incl. `new WebAssembly.Module`/`Instance` verified on Firefox 153.)
- [ ] Test against a handful of real-world WASM-using sites (e.g. Figma, Google Earth, a Unity WebGL build, a wasm-based crypto site) to see what breaks. (Header/CSP survey done for 12 sites; full interactive interception matrix pending — see docs/feasibility.md §6.)
- [x] Identify CSP-heavy sites that block hook injection; document failure modes. (docs/feasibility.md §4.)
- [x] Decide on manifest version strategy: MV3 primary, with fallback injection path for older browser versions. (docs/feasibility.md §3.)
- [~] Spike: load Binaryen.js and wabt.js inside a `MAIN`-world content script; confirm no CSP/`wasm-unsafe-eval` issues in a basic case. (Node-side generation works; browser UMD builds not available in env — open item, docs/feasibility.md §5.)
- [x] Write up findings as an internal feasibility doc (what works, what's blocked, what needs workarounds). (docs/feasibility.md.)

**Exit criteria:** You can reliably intercept and log WASM bytes on at least 80% of a test list of 20 real sites, in both Chrome and Firefox.

---

## Phase 1 — Core Interception Engine (MVP)

**Goal:** Ship the minimal plumbing: detect, intercept, and pass through WASM loads unmodified, with a console log — no UI yet.

- [ ] `manifest.json` with:
  - [ ] `MAIN`-world content script (`page-hook.js`) at `document_start`
  - [ ] `ISOLATED`-world bridge script (`isolated-bridge.js`)
  - [ ] `storage` + `scripting` + `<all_urls>` host permissions
- [ ] Implement full hook surface in `page-hook.js`:
  - [ ] `WebAssembly.instantiate` (Module and BufferSource overloads)
  - [ ] `WebAssembly.instantiateStreaming`
  - [ ] `WebAssembly.compile`
  - [ ] `WebAssembly.compileStreaming`
  - [ ] `new WebAssembly.Module(bytes)` constructor (sync path, Workers use this)
  - [ ] `new WebAssembly.Instance(module, imports)` constructor
- [ ] Normalize all input types to `Uint8Array` (`ArrayBuffer`, `Response`, `Promise<Response>`, typed array views).
- [ ] Fallback injection path (`<script>` tag + `web_accessible_resources`) for browsers without `world: "MAIN"` support.
- [ ] Worker support: inject the same hook into dedicated/shared/service workers (requires separate injection strategy — see Phase 6).
- [ ] Verify hook installs before any page WASM load fires, across the Phase 0 test site list.
- [ ] Basic console logging: module size, originating URL, call stack of the load site.

**Exit criteria:** Extension installed → every WASM load on any page gets logged to console with byte length and triggering stack trace, and the page continues to function identically (no behavior change yet).

---

## Phase 2 — Script Model & Storage

**Goal:** Define what a "wasMonkey script" is, and persist/load them.

- [ ] Design script metadata header format (Tampermonkey-style):

```
// ==WasMonkeyScript==
// @name        ...
// @match       ...
// @exclude     ...
// @run-at      document-start | before-instantiate
// @grant       patchBytes | patchExports | network
// @version     ...
// ==/WasMonkeyScript==
```

- [ ] Parser for the metadata block (regex or small state machine).
- [ ] Storage schema in `chrome.storage.local`:

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

- [ ] CRUD functions: `addScript`, `updateScript`, `deleteScript`, `toggleScript`, `listScriptsForUrl`.
- [ ] `isolated-bridge.js`: fetch matching scripts for current URL, serialize, pass to `MAIN` world via `CustomEvent`.
- [ ] Handle `@exclude` precedence and multiple `@match` patterns (glob → regex conversion, matching Tampermonkey semantics where reasonable).
- [ ] Import/export scripts as JSON (for backup/sharing before a full registry exists — see Phase 11).

**Exit criteria:** You can add a script via `chrome.storage` (manually, via devtools, no UI yet), reload a matching page, and see it picked up and executed inside `page-hook.js`.

---

## Phase 3 — Management UI (Dashboard)

**Goal:** Give users a real interface instead of raw `chrome.storage` edits.

- [ ] Options page (`options.html`) built with a lightweight framework (Preact/Svelte/vanilla — keep it light).
- [ ] Script list view: name, match pattern, enabled toggle, last modified.
- [ ] Script editor:
  - [ ] CodeMirror or Monaco integration with JS syntax highlighting
  - [ ] Metadata header auto-managed via form fields (name/match/exclude/grants) synced to the comment block
  - [ ] Save / Save & Reload Active Tab
- [ ] "New script from template" flow (templates: logger, export-wrapper, byte-patcher — ship 3 starter templates from Phase 1/4 examples).
- [ ] Popup (toolbar button) UI:
  - [ ] Shows WASM modules detected on current page (count, sizes)
  - [ ] Shows which scripts are active on current page
  - [ ] Quick enable/disable per site
  - [ ] "Report issue" / "View console log" shortcut
- [ ] Settings page: global enable/disable, logging verbosity, cache management (ties into Phase 9).
- [ ] Dark/light theme parity with browser.

**Exit criteria:** A non-technical-ish user can install the extension, open the dashboard, write/paste a script, save it, and see it take effect on a real page — no devtools required.

---

## Phase 4 — Binary Patch Toolkit Integration

**Goal:** Let scripts do more than wrap JS-visible exports — actually rewrite the WASM binary.

- [ ] Bundle **Binaryen.js** as a `web_accessible_resource`; lazy-load into `MAIN` world only when a script requests it (perf).
- [ ] Bundle **wabt.js** (wasm2wat/wat2wasm) for human-readable diffing/patching workflows.
- [ ] Expose both via the `wasMonkey` API object (see Phase 5) rather than requiring every script to manage its own import.
- [ ] Ship a small internal utility library for common patch primitives:
  - [ ] `findFunctionByExportName(module, name)`
  - [ ] `replaceFunctionBody(module, index, newWatSnippet)`
  - [ ] `patchConstant(bytes, oldValue, newValue)` (generalize the SLEB128 example to variable-length encode/decode, not just same-length swaps)
  - [ ] `injectImportTrampoline(module, importName, jsCallback)` — auto-wires a new import + calls into it from a chosen function (groundwork for instrumentation, inspired by Wasabi's approach)
- [ ] Optional: vendor a WASM build of **Wasabi** for scripts that want full instruction-level instrumentation (entry/exit/call/memory-access hooks) rather than hand-rolled Binaryen IR edits.
- [ ] Document the three "patch tiers" for script authors:
  1. **Export wrapping** (Phase 1 level, no binary knowledge needed)
  2. **Constant/byte patching** (medium, needs basic binary format knowledge)
  3. **Full IR rewriting via Binaryen/Wasabi** (advanced)
- [ ] Write 3–5 real example scripts demonstrating each tier against public demo WASM binaries (not live third-party sites, to avoid ToS issues in the example repo).

**Exit criteria:** A script can take raw bytes, run them through Binaryen, modify a function body, re-emit, and have the patched module actually instantiate and run correctly in the page.

---

## Phase 5 — Developer API (`wasMonkey` object)

**Goal:** Stabilize the API surface scripts are written against — this is your "GM_*" equivalent.

- [ ] Define and document the global `wasMonkey` object available inside script execution context:

```ts
interface WasMonkeyAPI {
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

- [ ] Replace the ad hoc `globalThis.__wasmonkeyHooks` pattern from the prototype with this registration API.
- [ ] Enforce the `@grant` declarations from script metadata — a script without `@grant patchBytes` shouldn't be able to register an `onBeforeInstantiate` hook (principle of least privilege, mirrors Tampermonkey's `@grant` model).
- [ ] Version the API (`wasMonkey.apiVersion`) so future breaking changes don't silently break old scripts.
- [ ] Write full API reference docs + JSDoc types (ship a `.d.ts` for script authors using TS).

**Exit criteria:** All example scripts from Phase 4 are rewritten against this stable API instead of ad hoc globals.

---

## Phase 6 — Cross-Browser Compatibility

**Goal:** Make "cross-browser" true in practice, not just in the manifest.

- [ ] **Chrome / Chromium (Edge, Brave, Opera, Arc):** MV3, `world: "MAIN"` — primary target, should just work from Phase 1.
- [ ] **Firefox:** confirm MV3 `world: "MAIN"` support in current stable + ESR; provide MV2-style fallback (`tabs.executeScript` with `world` polyfill or `<script>` tag injection) for older ESR users.
- [ ] **Safari (WebExtensions):** no `world: "MAIN"` equivalent reliably — use the `<script>` tag + `web_accessible_resources` fallback as primary path; test against Safari's stricter review/CSP behavior.
- [ ] Abstract the injection mechanism behind a single internal module (`inject.ts`) with per-browser strategies selected at build time (feature-detect or UA-sniff + build flags).
- [ ] Worker context injection:
  - [ ] Dedicated Workers: intercept `new Worker(url)` in `MAIN` world, rewrite the worker script to self-inject the hook at the top (prepend via blob URL rewrite), since you can't directly content-script into a worker.
  - [ ] Service Workers: similar prepend strategy, careful with caching/update semantics.
- [ ] Build pipeline: single codebase, per-browser manifest generation (webextension-polyfill or custom build step for `browser.*` vs `chrome.*` API differences).
- [ ] Automated cross-browser smoke test matrix (see Phase 10) run on every release.

**Exit criteria:** Same `.zip`/build pipeline produces working extensions for Chrome, Firefox, and Safari, verified against the Phase 0 test site list on each.

---

## Phase 7 — CSP, Security & Edge Cases

**Goal:** Handle the real-world hostile environment of arbitrary third-party pages.

- [ ] Detect and handle strict CSP (`script-src`, lack of `'wasm-unsafe-eval'`) that blocks re-instantiation of patched bytes.
  - [ ] Where possible, use `declarativeNetRequest` to relax/strip conflicting CSP headers (document the ethical/ToS tradeoffs clearly in docs — this is a power-user opt-in feature, off by default).
- [ ] Handle SRI (Subresource Integrity) on fetched `.wasm` files — patched bytes will fail integrity checks if the page validates hashes; detect and warn the user rather than silently breaking the page.
- [ ] Sandbox script execution as much as the platform allows:
  - [ ] Scripts run in page's `MAIN` world by necessity (to touch `WebAssembly`), so true isolation from the page's JS isn't possible — document this clearly as a trust boundary (same caveat Tampermonkey has for `@grant none` vs page-context scripts).
  - [ ] Still sandbox _user scripts from each other_ (don't let one script's crash take down another's hook).
- [ ] Wrap every user hook invocation in try/catch with per-script error isolation + surfaced errors in the popup UI.
- [ ] Add a "panic switch": global disable toggle + per-site quick-disable, in case a script breaks a page the user needs.
- [ ] Threat-model doc: what wasMonkey can and can't protect the user from (e.g., a malicious script the user installs has full page access — same trust model as any userscript manager).

**Exit criteria:** Known-CSP-strict sites either work via relaxation, or fail gracefully with a clear on-page notice rather than silently breaking.

---

## Phase 8 — Debugging & Developer Experience

**Goal:** Make writing WASM patch scripts tractable for humans.

- [ ] Built-in **WASM → WAT viewer** in the dashboard: paste/upload a `.wasm`, see disassembly (via wabt), searchable by export name/function index.
- [ ] **Diff view**: original bytes vs patched bytes, shown as WAT diff, so script authors can sanity-check a patch before shipping it.
- [ ] **Live inspector** in the popup: list of WASM modules loaded on the current page with export names, memory size, table size — click to dump exports to console.
- [ ] Source map / DWARF awareness: if a module ships debug info, surface function names instead of raw indices wherever possible.
- [ ] "Record mode": log every `instantiate` call's stack trace + bytes hash for a page without writing a script, to help users figure out _which_ module they even want to target.
- [ ] Error overlay: when a user script throws, show a toast/log in the popup with script name + stack, not just buried in devtools console.

**Exit criteria:** A user with no prior WASM internals experience can open the dashboard, inspect a target site's module, find an export, and write a working export-wrapping script without leaving the extension UI.

---

## Phase 9 — Performance & Caching

**Goal:** Don't make every page load slower by re-running Binaryen on every WASM fetch.

- [ ] Hash incoming bytes (`SHA-256` via `crypto.subtle`) before patching.
- [ ] Cache `{hash + scriptVersion} → patchedBytes` in `IndexedDB` (storage.local has size limits; use IDB for binary blobs).
- [ ] Skip the patch pipeline entirely if no enabled script matches the current URL (fast-path passthrough — this should be the common case on 99% of pages).
- [ ] Lazy-load Binaryen/wabt only when a script actually calls `getBinaryen()`/`getWabt()` — don't pay that cost on every page.
- [ ] Measure and budget: target <5ms overhead added to a WASM load when no script matches; document acceptable overhead when patching is active.
- [ ] Cache invalidation on script edit/update (bump a script version counter used in the cache key).

**Exit criteria:** Pages with no matching scripts show no measurable (within noise) load-time regression; pages with active byte-patching scripts cache after first patch and don't re-run Binaryen on subsequent loads/reloads of the same module.

---

## Phase 10 — Testing & QA

**Goal:** Confidence that releases don't silently break the web.

- [ ] Unit tests for:
  - [ ] Metadata header parser
  - [ ] Glob/match pattern → regex conversion
  - [ ] SLEB128/LEB128 encode-decode helpers
  - [ ] Storage CRUD layer
- [ ] Integration tests (headless browser, e.g. Playwright) against:
  - [ ] A small suite of local test `.wasm` fixtures (hand-built, covering `instantiate`/`instantiateStreaming`/`compile`/Worker loading/various import/export shapes)
  - [ ] The Phase 0 real-site list, asserting the page still loads/functions with the extension active and zero scripts enabled (pure passthrough correctness)
- [ ] Regression suite: for each example script (Phase 4/5), assert expected before/after behavior against its fixture module.
- [ ] Cross-browser matrix run via Playwright (Chromium, Firefox) + manual Safari pass (less automatable).
- [ ] Fuzz testing: feed malformed/truncated WASM bytes through the pipeline to make sure a broken module can't crash the extension or hang the page.
- [ ] Manual security review pass before each release (CSP bypass behavior, permission scope, script sandboxing assumptions).

**Exit criteria:** CI pipeline runs unit + integration + fixture regression suite on every PR; manual real-site pass before every tagged release.

---

## Phase 11 — Script Ecosystem (Community Layer)

**Goal:** The Tampermonkey analogy only pays off fully once there's a script-sharing culture.

- [ ] Script export format: single `.wasmonkey.js` file with metadata header (already defined in Phase 2) — trivially shareable as a gist/file.
- [ ] "Import from URL" in the dashboard (paste a raw gist/file URL → fetch, parse, preview metadata, install) — mirror Tampermonkey/Greasyfork UX.
- [ ] Optional: stand up a lightweight community index site (like Greasy Fork) once there's real user demand — not a Phase-1 priority, gate behind actual adoption signal.
- [ ] Script signing/checksum display so users can verify a shared script hasn't been tampered with before install (basic trust signal, not full PKI).
- [ ] Clear community guidelines doc: scripts that bypass paywalls/anti-cheat/DRM-adjacent protections are the user's own legal/ethical responsibility — same disclaimer posture as Tampermonkey/Greasy Fork.

**Exit criteria:** A user can export a script, share the file, and another user can import it into their own dashboard in under 30 seconds.

---

## Phase 12 — Packaging, Store Submission & Docs

**Goal:** Ship it.

- [ ] Finalize icon set, store screenshots, promotional copy.
- [ ] Privacy policy (what data touches `chrome.storage`/network — should be "nothing leaves the device" if designed right; state that explicitly).
- [ ] Chrome Web Store submission (expect manual review scrutiny given `<all_urls>` + code-execution nature — be ready to explain purpose clearly, possibly expect pushback given similarity to "remote code injection" patterns; have a fallback sideload/self-host distribution plan).
- [ ] Firefox Add-ons (AMO) submission — note AMO does **source review** for extensions that bundle minified/bundled libraries (Binaryen.js, wabt.js); prepare readable source + build instructions to pass review.
- [ ] Safari Extension packaging via Xcode + App Store Connect (heavier process, budget real time for this).
- [ ] Self-hosted `.xpi`/`.crx`/`.zip` fallback distribution + docs for sideloading, for users/stores that reject it.
- [ ] Documentation site: installation guide, API reference (Phase 5 output), script-writing tutorial, FAQ, security/ethics disclaimer.
- [ ] Changelog + semantic versioning policy from v1.0.0 onward.

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
- [ ] Explore a companion CLI (`wasmonkey-cli`) for authoring/testing scripts against local `.wasm` files outside the browser, for a faster dev loop.

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
