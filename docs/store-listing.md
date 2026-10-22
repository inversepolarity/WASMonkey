# Store Listing Copy

**Name:** WASMonkey — Tampermonkey for WebAssembly
**Short description:** Intercept, inspect, and patch WebAssembly modules at load time.
**Category:** Developer Tools

## Description
WASMonkey lets you write userscripts that intercept and patch WebAssembly modules
as they load in the browser. Override `WebAssembly.instantiate`, inspect bytes,
rewrite IR with Binaryen/wabt, and wrap exports — all from a dashboard UI.

## Permissions
- `<all_urls>` / host permissions: needed to inject the hook on any page.
- `storage`: persist scripts and settings.
- `scripting`: fallback injection.
- `declarativeNetRequest`: opt-in CSP relaxation.

## Privacy
Nothing leaves the device. See privacy-policy.md.