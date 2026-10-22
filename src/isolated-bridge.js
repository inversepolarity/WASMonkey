(function () {
  "use strict";
  // ISOLATED-world bridge. Runs alongside the MAIN-world page-hook.js.
  // Responsibilities in later phases: fetch matching scripts for the current URL
  // from chrome.storage and forward them to the MAIN world via CustomEvent;
  // enforce @grant; provide the isolated side of the wasMonkey API.
  // Phase 1: fallback injection path + global enable check + message relay.

  var TAG = "[wasMonkey-bridge]";
  // Expose extension resource URLs to the MAIN world (page-hook.js).
  var _workerHookURL = null, _extBaseURL = null;
  try { _workerHookURL = chrome.runtime.getURL("src/worker-hook.js"); } catch (e) {}
  try { _extBaseURL = chrome.runtime.getURL(""); } catch (e) {}
  console.log("[wasMonkey-bridge] workerHookURL=", _workerHookURL, "extBase=", _extBaseURL);
  // Propagate to MAIN world (isolated and MAIN don't share window properties).
  try {
    var s = document.createElement("script");
    s.textContent = "window.__wasMonkeyWorkerHookURL=" + JSON.stringify(_workerHookURL) + "; window.__wasMonkeyExtBaseURL=" + JSON.stringify(_extBaseURL) + ";";
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {}
  try {
    document.dispatchEvent(new CustomEvent("wasmonkey:ext-base", { detail: JSON.stringify({ workerHookURL: _workerHookURL, extBaseURL: _extBaseURL }) }));
  } catch (e) {}

  function injectFallback() {
    try {
      // Only inject if the MAIN-world hook has not already installed itself.
      // page-hook.js is idempotent (guards on window.__wasMonkeyInstalled),
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
    chrome.storage.local.get({ logVerbosity: "normal", recordMode: false }, function (res) {
      try {
        var s = document.createElement("script");
        s.textContent = "window.__wasMonkeyLogVerbosity=" + JSON.stringify(res.logVerbosity || "normal") + "; window.__wasMonkeyRecordMode=" + JSON.stringify(res.recordMode === true) + ";";
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
          s.textContent = "window.__wasMonkeyRecordMode = true;";
          (document.head || document.documentElement).appendChild(s);
          s.remove();
        } catch (e) {}
      }
    });
  } catch (e) {}

  // Panic switch: global disable + per-site quick-disable.
  try {
    chrome.storage.local.get({ wasMonkeyEnabled: true, disabledSites: [] }, function (res) {
      var disabled = false;
      if (res && res.wasMonkeyEnabled === false) disabled = true;
      try {
        var host = location.hostname;
        if (Array.isArray(res && res.disabledSites) && res.disabledSites.indexOf(host) >= 0) disabled = true;
      } catch (e) {}
      if (disabled) {
        try { document.dispatchEvent(new CustomEvent("wasmonkey:disable")); } catch (e) {}
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

  // Relay channel placeholder for Phase 2 script delivery.
  // MAIN world emits "wasmonkey:request-scripts"; bridge replies with
  // "wasmonkey:scripts" carrying serialized matching scripts.
  document.addEventListener("wasmonkey:request-scripts", function (ev) {
    try {
      var url = (ev && ev.detail) ? ev.detail : location.href;
      if (typeof wasMonkeyStorage !== "undefined" && wasMonkeyStorage.listScriptsForUrl) {
        wasMonkeyStorage.listScriptsForUrl(url, function (err, scripts) {
          var version = "0";
          try { version = (scripts || []).map(function (s) { return s.updatedAt || s.createdAt || 0; }).reduce(function (a, b) { return Math.max(a, b); }, 0).toString(); } catch (e) {}
          try {
            document.dispatchEvent(new CustomEvent("wasmonkey:scripts", {
              detail: JSON.stringify({ scripts: scripts || [], version: version })
            }));
          } catch (e) {}
        });
      } else {
        chrome.storage.local.get({ scripts: [] }, function (res) {
          try {
            document.dispatchEvent(new CustomEvent("wasmonkey:scripts", {
              detail: JSON.stringify({ scripts: (res && res.scripts) || [], version: "0" })
            }));
          } catch (e) {}
        });
      }
    } catch (e) {}
  });

  console.log(TAG + " isolated bridge loaded");
})();
