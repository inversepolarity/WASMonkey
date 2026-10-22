# Changelog

## [1.0.0] - 2026-10-22

### Added
- Core WASM interception engine (all six entry points).
- Script model & storage (`chrome.storage.local`).
- Management dashboard with CodeMirror 6 editor.
- Binaryen.js + wabt.js toolkit integration.
- `wasMonkey` developer API (v1) with `@grant` enforcement.
- Cross-browser support (Chrome, Firefox).
- CSP handling + panic switch.
- Debugging tools: WASM→WAT viewer, diff view, live inspector, record mode.
- Performance: IndexedDB patch cache, fast-path passthrough, lazy toolkit loading.
- Unit + integration + fuzz tests.