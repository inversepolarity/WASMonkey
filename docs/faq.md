# FAQ

**Q: Does WASMonkey send my data anywhere?**
A: No. Everything stays on your device.

**Q: Why does it need `<all_urls>`?**
A: To inject the hook on any page that uses WebAssembly.

**Q: A script broke my page.**
A: Use the panic switch (global disable / per-site disable) in the popup.

**Q: Chrome says "Unsafe" during review?**
A: The extension is a userscript manager for WASM; sideload via docs/sideload.md if rejected.

**Q: Nothing in my script runs — no `WASMonkey.log`, no hooks (Firefox, wasm loads at document_start).**
A: Fixed in this revision. Firefox evaluates `document_start` content scripts from
different manifest entries one after another, so `page-hook.js` (MAIN world) used
to finish — and fire its single `WASMonkey:request-scripts` event — before
`isolated-bridge.js` had registered its listener. The payload was lost and no
script ever reached the page. The bridge now pushes scripts proactively at
startup and again on DOMContentLoaded/load/storage changes, and the MAIN side
re-requests with backoff. Console should show
`[WASMonkey] 1 script(s) applied` right after `hook installed`.
You can force a re-sync at any time with `__WASMonkeyRefreshScripts()`.

**Q: My hooks fire for later modules but missed the first one.**
A: The first async `WebAssembly.instantiate*`/`compile*` call waits up to
`startupGraceMs` (default 300) for the script payload, so a cold start usually
still gets patched. `onAfterInstantiate` is additionally replayed for instances
created before delivery (the callback's `ctx.replayed` is `true` for those).
Before-instantiate patching cannot be replayed — nothing can un-compile a
module — so set `startupGraceMs` higher in `chrome.storage.local` if a page
beats the window.

**Q: `onBeforeInstantiate` is ignored and I only get a "lacks @grant" warning.**
A: Grants declared as `// @grant patchBytes` in the script header now count the
same as the grant field in the editor; both are merged when the script is saved.

