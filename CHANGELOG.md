# Changelog

## [Unreleased]

### Fixed
- **User scripts were never delivered on Firefox.** `page-hook.js` (MAIN world)
  fired a single `WASMonkey:request-scripts` event during `document_start`,
  strictly before `isolated-bridge.js` (ISOLATED world) had registered its
  listener, so the payload was lost and no hook ever ran — modules were logged
  but `WASMonkey.log`, `onBeforeInstantiate` and `onAfterInstantiate` were dead.
  The bridge now pushes scripts proactively at startup and re-syncs on
  `DOMContentLoaded`, `load`, `pageshow` and `chrome.storage.onChanged`, while
  the page side re-requests with backoff until answered.
- Script delivery is now idempotent (`id` + `updatedAt`), so re-pushes do not
  run a script body twice or double-register hooks.
- A missing bridge is now reported (`no script payload received…`) instead of
  failing silently; a successful delivery logs `N script(s) applied`.
- `onAfterInstantiate` is replayed for modules instantiated before the scripts
  arrived, and the first async instantiation waits a bounded `startupGraceMs`
  (default 300 ms) so `onBeforeInstantiate` can still patch document_start wasm.
- `@grant` lines in a script's code header are now merged with the stored grant
  list (dashboard, `WASMonkeyStorage.add/updateScript` and the page hook), so a
  header-only `// @grant patchBytes` no longer gets the hook silently ignored.

## [1.0.0] - 2026-10-22

### Added
- Core WASM interception engine (all six entry points).
- Script model & storage (`chrome.storage.local`).
- Management dashboard with CodeMirror 6 editor.
- Binaryen.js + wabt.js toolkit integration.
- `WASMonkey` developer API (v1) with `@grant` enforcement.
- Cross-browser support (Chrome, Firefox).
- CSP handling + panic switch.
- Debugging tools: WASM→WAT viewer, diff view, live inspector, record mode.
- Performance: IndexedDB patch cache, fast-path passthrough, lazy toolkit loading.
- Unit + integration + fuzz tests.