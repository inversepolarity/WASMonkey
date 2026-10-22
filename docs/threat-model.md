# WASMonkey Threat Model

## Trust boundary
WASMonkey scripts run in the page's MAIN world by necessity (they must touch
`WebAssembly`). A script you install has the same access to the page as any
page script — same caveat as Tampermonkey's `@grant none` scripts. Only install
scripts from sources you trust.

## What WASMonkey does
- Sandboxes user scripts from each other: each hook invocation is wrapped in
  try/catch with per-script error isolation; one script's crash does not take
  down another's hook.
- Enforces `@grant` declarations: a script without `@grant patchBytes` cannot
  register `onBeforeInstantiate`.
- Provides a global disable toggle and per-site quick-disable (panic switch).
- Optionally relaxes CSP headers (opt-in, off by default) via declarativeNetRequest.

## What WASMonkey cannot protect against
- A malicious installed script has full page access (same as any userscript
  manager). Verify scripts before installing; prefer shared scripts with
  checksums.
- Store rejection risk due to code-injection nature; sideload fallback exists.

## CSP / SRI
- Strict CSP without `wasm-unsafe-eval`/`unsafe-eval` blocks re-instantiation
  of patched bytes; WASMonkey detects and warns, and may fall back to the
  original module. Opt-in CSP relaxation can help.
- SRI on fetched `.wasm` will fail after patching; WASMonkey warns rather than
  silently breaking the page.