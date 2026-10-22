(function () {
  "use strict";
  // Unified injection abstraction (Phase 6).
  // Strategies:
  //  - "main-world": manifest world:MAIN (Chrome/Firefox current) — handled by manifest.
  //  - "script-tag": <script src="chrome-extension://.../src/page-hook.js"> fallback (Safari/older Firefox).
  //  - "cdp": test-only injection via Page.addScriptToEvaluateOnNewDocument.
  // This module centralizes the fallback path so per-browser builds can select
  // the strategy at build time.

  function supportsMainWorld() {
    // Heuristic: Chrome/Firefox current expose chrome.scripting with world support.
    try { return !!(chrome && chrome.scripting && typeof chrome.scripting.executeScript === "function"); } catch (e) { return false; }
  }

  function injectScriptTag(path) {
    try {
      var s = document.createElement("script");
      s.src = (typeof chrome !== "undefined" && chrome.runtime) ? chrome.runtime.getURL(path) : path;
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      return true;
    } catch (e) { return false; }
  }

  function injectPageHook() {
    // Idempotent: page-hook.js guards on window.__wasMonkeyInstalled.
    return injectScriptTag("src/page-hook.js");
  }

  var api = { supportsMainWorld: supportsMainWorld, injectScriptTag: injectScriptTag, injectPageHook: injectPageHook };
  try { window.wasMonkeyInject = api; } catch (e) {}
  try { if (typeof globalThis !== "undefined") globalThis.wasMonkeyInject = api; } catch (e) {}
})();
