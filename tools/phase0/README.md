# Phase 0 follow-up tooling

Automated tooling that resolves the four limitations of the original Phase 0
run (see `docs/feasibility.md` §8). Everything runs headless and
non-interactively; no manual browser session is needed.

## Pieces

| File | Purpose |
|---|---|
| `browser.mjs` | Provisions a headless-capable Chromium 153 from `@sparticuz/chromium` (registry.npmjs.org — inside the sandbox egress allowlist) into `~/.cache/wasmonkey/` (outside git). Idempotent. |
| `vendor.mjs` | Vendors the official **browser** builds of Binaryen.js and wabt.js from npm into `vendor/` with SHA-256 pinning in `vendor.lock.json`. |
| `serve.mjs` | Local fixture server: static repo files, `/collect` endpoint (same contract as `test/harness.html`), and 12 CSP fixture profiles (`/site/<profile>`, `/spike/<profile>`) replicating the §4 site survey + generic policy classes. |
| `cdputil.mjs` | Launch + instrumentation helpers: two run modes (`extension` via `--load-extension`; `cdp-inject` via `Page.addScriptToEvaluateOnNewDocument`), reliable CDP console/security capture, `/collect` cross-check (console parity). |
| `matrix.mjs` | The interception matrix runner (all 12 profiles + the original harness; `--url-list` for live sites). Writes `test/results/interception-matrix.{json,md}`. |
| `spike.mjs` | The Binaryen/wabt in-browser spike (parse → emit → instantiate per CSP profile + the hook's `getBinaryen()`/`getWabt()` lazy-load API). Writes `test/results/toolkit-spike.{json,md}`. |
| `smoke.mjs` | One-shot sanity check on the original harness page. |

## Run

```bash
cd tools/phase0
npm install            # puppeteer-core + binaryen + wabt (dev deps of the tooling)
node vendor.mjs        # populate ../../vendor/ (checksum-pinned)
node smoke.mjs         # quick harness check
node matrix.mjs        # full interception matrix
node spike.mjs         # toolkit spike under all CSP profiles
npx web-ext lint --source-dir ../.. --self-hosted   # static manifest validation
```

On a machine with full Chrome/Chromium installed, the exact same matrix
exercises the real manifest path end-to-end:

```bash
node matrix.mjs --mode extension --chrome /path/to/chrome
node matrix.mjs --url-list test-sites.txt   # Phase 10 live-site pass
```

(`--chrome` falls back to the provisioned sandbox Chromium when omitted. The
sandbox build is Chrome's `headless_shell`, whose extensions subsystem is
compiled out, so in-sandbox runs automatically fall back to `cdp-inject`
mode — the same renderer mechanism that executes `world: "MAIN"` content
scripts, minus extension plumbing. The mode used is recorded in every
result file.)

## Run modes

- **`extension`** — repo loaded as an unpacked MV3 extension
  (`--load-extension` + `--disable-extensions-except`). Highest fidelity:
  manifest parsing + `world: "MAIN"` injection path.
- **`cdp-inject`** — `src/page-hook.js` injected into the MAIN world at
  document_start via CDP. Works on every CDP-capable Chromium.
- **`auto`** (default) — probes `extension` on a CSP-free fixture, falls back
  to `cdp-inject` when the browser build lacks extension support.
