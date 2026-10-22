(function () {
  "use strict";
  // ISOLATED-world bridge. Runs alongside the MAIN-world page-hook.js.
  // Responsibilities in later phases: fetch matching scripts for the current URL
  // from chrome.storage and forward them to the MAIN world via CustomEvent;
  // enforce @grant; provide the isolated side of the WASMonkey API.
  // Phase 1: fallback injection path + global enable check + message relay.

  var TAG = "[WASMonkey-bridge]";
  // Expose extension resource URLs to the MAIN world (page-hook.js).
  var _workerHookURL = null, _extBaseURL = null;
  try { _workerHookURL = chrome.runtime.getURL("src/worker-hook.js"); } catch (e) {}
  try { _extBaseURL = chrome.runtime.getURL(""); } catch (e) {}
  console.log("[WASMonkey-bridge] workerHookURL=", _workerHookURL, "extBase=", _extBaseURL);
  // Propagate to MAIN world (isolated and MAIN don't share window properties).
  try {
    var s = document.createElement("script");
    s.textContent = "window.__WASMonkeyWorkerHookURL=" + JSON.stringify(_workerHookURL) + "; window.__WASMonkeyExtBaseURL=" + JSON.stringify(_extBaseURL) + ";";
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {}
  try {
    document.dispatchEvent(new CustomEvent("WASMonkey:ext-base", { detail: JSON.stringify({ workerHookURL: _workerHookURL, extBaseURL: _extBaseURL }) }));
  } catch (e) {}

  // --- user-script delivery (MAIN world <- here) --------------------------
  // The MAIN-side hook may finish before this file is even evaluated
  // (Firefox evaluates document_start content scripts one entry at a time),
  // which loses its one-shot "WASMonkey:request-scripts" event. So we push the
  // matching scripts proactively at startup as well, and again when the DOM is
  // ready and whenever the script store changes.
  var _lastPushedKey = null;

  function collectScripts(cb) {
    try {
      if (typeof WASMonkeyStorage !== "undefined" && WASMonkeyStorage.listScriptsForUrl) {
        WASMonkeyStorage.listScriptsForUrl(location.href, function (err, scripts) {
          cb(err ? [] : (scripts || []));
        });
        return;
      }
    } catch (e) {}
    try {
      chrome.storage.local.get({ scripts: [] }, function (res) {
        cb((res && res.scripts) || []);
      });
    } catch (e) { cb([]); }
  }

  function deliverScripts(force) {
    collectScripts(function (scripts) {
      var version = "0";
      try {
        version = (scripts || []).map(function (s) {
          return s.updatedAt || s.createdAt || 0;
        }).reduce(function (a, b) { return Math.max(a, b); }, 0).toString();
      } catch (e) {}
      var key = (scripts || []).map(function (s) {
        return [s.id, s.updatedAt || s.createdAt || 0, s.enabled === false ? 0 : 1].join(":");
      }).join("|");
      // A request from the MAIN world is answered even if it looks identical;
      // the page side de-duplicates before re-running scripts.
      if (!force && key === _lastPushedKey) return;
      _lastPushedKey = key;
      try {
        document.dispatchEvent(new CustomEvent("WASMonkey:scripts", {
          detail: JSON.stringify({ scripts: scripts || [], version: version })
        }));
      } catch (e) {}
    });
  }

  // Shipped scripts are matched synchronously from a cold start: push now so a
  // MAIN hook that already raced past us still receives them.
  deliverScripts(true);

  function injectFallback() {
    try {
      // Only inject if the MAIN-world hook has not already installed itself.
      // page-hook.js is idempotent (guards on window.__WASMonkeyInstalled),
      // so injecting when already installed is a harmless no-op.
      var s = document.createElement("script");
      s.src = chrome.runtime.getURL("src/page-hook.js");
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      // Fallback injection can fail under very strict CSP; the manifest's
      // world:MAIN path (where supported) is the primary mechanism.
    }
  }

  // Attempt fallback injection shortly after document_start so the manifest's
  // MAIN-world injection (if supported) runs first.
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectFallback, { once: true });
    } else {
      setTimeout(injectFallback, 0);
    }
  } catch (e) {
    setTimeout(injectFallback, 0);
  }

  // Propagate settings to MAIN world.
  try {
    chrome.storage.local.get({ logVerbosity: "normal", recordMode: false, startupGraceMs: 300 }, function (res) {
      try {
        var s = document.createElement("script");
        s.textContent = "window.__WASMonkeyLogVerbosity=" + JSON.stringify(res.logVerbosity || "normal") +
          "; window.__WASMonkeyRecordMode=" + JSON.stringify(res.recordMode === true) +
          "; window.__WASMonkeyStartupGraceMs=" + JSON.stringify(typeof res.startupGraceMs === "number" ? res.startupGraceMs : 300) + ";";
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (e) {}
    });
  } catch (e) {}

  // Record mode: log every instantiate with stack + bytes hash.
  try {
    chrome.storage.local.get({ recordMode: false }, function (res) {
      if (res && res.recordMode === true) {
        try {
          var s = document.createElement("script");
          s.textContent = "window.__WASMonkeyRecordMode = true;";
          (document.head || document.documentElement).appendChild(s);
          s.remove();
        } catch (e) {}
      }
    });
  } catch (e) {}

  // Panic switch: global disable + per-site quick-disable.
  try {
    chrome.storage.local.get({ WASMonkeyEnabled: true, disabledSites: [] }, function (res) {
      var disabled = false;
      if (res && res.WASMonkeyEnabled === false) disabled = true;
      try {
        var host = location.hostname;
        if (Array.isArray(res && res.disabledSites) && res.disabledSites.indexOf(host) >= 0) disabled = true;
      } catch (e) {}
      if (disabled) {
        try { document.dispatchEvent(new CustomEvent("WASMonkey:disable")); } catch (e) {}
      }
    });
  } catch (e) {}

  // CSP relaxation (opt-in): strip CSP headers when enabled.
  try {
    chrome.storage.local.get({ cspRelaxation: false }, function (res) {
      if (res && res.cspRelaxation === true) {
        try {
          chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1001],
            addRules: [{
              id: 1001,
              priority: 1,
              action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] },
              condition: { urlFilter: "*", resourceTypes: ["main_frame", "sub_frame"] },
            }],
          }, function () {});
        } catch (e) {}
      }
    });
  } catch (e) {}

  // MAIN world emits "WASMonkey:request-scripts"; we answer with
  // "WASMonkey:scripts" carrying serialized matching scripts.
  document.addEventListener("WASMonkey:request-scripts", function () {
    deliverScripts(true);
  });

  // Re-sync once the document settles: covers a page-hook copy that was
  // injected late (fallback <script> path) and bfcache restores.
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { deliverScripts(true); }, { once: true });
    }
    window.addEventListener("load", function () { deliverScripts(true); }, { once: true });
    window.addEventListener("pageshow", function () { deliverScripts(true); }, { once: true });
  } catch (e) {}

  // Keep open tabs in sync when scripts are added/edited/toggled.
  try {
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== "local") return;
        if (changes && Object.prototype.hasOwnProperty.call(changes, "scripts")) {
          deliverScripts(true);
        }
      });
    }
  } catch (e) {}

  console.log(TAG + " isolated bridge loaded");
})();
