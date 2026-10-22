/**
 * battery.js — WASMonkey Phase 0 interception battery.
 *
 * Dual-mode fixture script:
 *  1. Loaded as an external <script> by /site/<profile> fixture pages (the
 *     server stamps the CSP nonce when the profile requires one). Auto-runs
 *     and POSTs per-entry results to /collect.
 *  2. Exposed as window.__wmBattery(profile) so the runner can drive it via
 *     CDP evaluate on profiles whose CSP blocks script loading entirely
 *     (e.g. default-src 'none').
 *
 * Each entry point is exercised independently; every step records
 * {entry, ok, bytes, error} so the matrix can distinguish "hook intercepted
 * the bytes" from "the CSP let the engine compile them".
 */
(function () {
  "use strict";

  var WASM_URL = "/test/sample.wasm";

  function appendCustomSection(bytes, name, payload) {
    function uleb(n) {
      var out = [];
      do { var b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
      return out;
    }
    var nameBytes = new TextEncoder().encode(name);
    var body = [].concat(uleb(nameBytes.length), Array.prototype.slice.call(nameBytes), Array.prototype.slice.call(payload));
    var section = [0].concat(uleb(body.length), body);
    var out = new Uint8Array(bytes.byteLength + section.length);
    out.set(bytes, 0);
    out.set(section, bytes.byteLength);
    return out;
  }

  function profileFromCurrentScript() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) {
        var m = /[?&]profile=([^&]+)/.exec(src);
        if (m) return decodeURIComponent(m[1]);
      }
    } catch (e) {}
    return "unknown";
  }

  window.__wmBattery = async function (profile) {
    var results = {
      profile: profile || "unknown",
      hookInstalled: !!window.__WASMonkeyInstalled,
      extBase: window.__WASMonkeyExtBaseURL || null,
      ua: navigator.userAgent,
      entries: [],
      errors: [],
    };
    function record(entry, ok, bytes, error) {
      results.entries.push({ entry: entry, ok: !!ok, bytes: bytes || 0, error: error ? String(error) : null });
    }

    var buf = null;
    try {
      var r = await fetch(WASM_URL);
      buf = await r.arrayBuffer();
      record("fetchBytes", true, buf.byteLength);
    } catch (e) {
      record("fetchBytes", false, 0, (e && e.message) || e);
    }

    if (buf) {
      var bytes = new Uint8Array(buf);
      var attempts = [
        ["compile", async function () { await WebAssembly.compile(buf); return bytes.byteLength; }],
        ["instantiate", async function () { await WebAssembly.instantiate(buf, {}); return bytes.byteLength; }],
        ["instantiateStreaming", async function () { await WebAssembly.instantiateStreaming(fetch(WASM_URL), {}); return bytes.byteLength; }],
        ["compileStreaming", async function () { await WebAssembly.compileStreaming(fetch(WASM_URL)); return bytes.byteLength; }],
        ["ModuleCtor", async function () { var m = new WebAssembly.Module(buf); new WebAssembly.Instance(m, {}); return bytes.byteLength; }],
        ["instantiateModuleOverload", async function () { var m = new WebAssembly.Module(buf); await WebAssembly.instantiate(m, {}); return bytes.byteLength; }],
        ["patchedReinstantiate", async function () {
          var patched = appendCustomSection(bytes, "WASMonkey", new TextEncoder().encode("phase0"));
          var m = new WebAssembly.Module(patched.buffer);
          await WebAssembly.instantiate(m, {});
          return patched.byteLength;
        }],
      ];
      for (var i = 0; i < attempts.length; i++) {
        var name = attempts[i][0], fn = attempts[i][1];
        try { record(name, true, await fn()); }
        catch (e) { record(name, false, 0, (e && e.message) || e); }
      }
    }

    results.hookInstalledAfter = !!window.__WASMonkeyInstalled;
    results.logs = (window.__WASMonkeyLogs || []).slice();
    return results;
  };

  // --- auto-run when loaded as a page script -------------------------------
  function post(payload) {
    try { fetch("/collect", { method: "POST", body: JSON.stringify(payload) }); } catch (e) {}
  }

  // When the runner injects this file via CDP evaluate (profiles whose CSP
  // blocks script loading), it sets globalThis.__wmCdpDriven first and calls
  // window.__wmBattery(profile) itself — auto-run is suppressed.
  if (!globalThis.__wmCdpDriven) {
    var profile = profileFromCurrentScript();
    window.__wmBattery(profile).then(
      function (res) { post(Object.assign({ stage: "done" }, res)); },
      function (err) { post({ stage: "error", profile: profile, message: String((err && err.message) || err) }); }
    );
    setTimeout(function () { post({ stage: "timeout", profile: profile }); }, 8000);
  }
})();
