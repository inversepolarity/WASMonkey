/**
 * spike.js — Binaryen.js / wabt.js in-page (MAIN-world) toolkit spike.
 *
 * Completes the Phase 0 §5 open item: load the vendored *browser* builds of
 * wabt (UMD classic script) and Binaryen (ESM, top-level await) inside a page
 * under a given CSP profile, run a real parse→emit→instantiate roundtrip with
 * each, and exercise the WASMonkey hook's lazy-load API (getWabt/getBinaryen).
 *
 * Every step records {step, ok, ms, error}; results POST to /collect as
 * stage:"spike-done" (or are returned directly when the runner drives this
 * file via CDP evaluate under script-blocking CSPs).
 *
 * Script-loading strategy per library:
 *   a) plain dynamic <script> / import() from the page origin
 *   b) retry with the server-provided CSP nonce (<meta name="wm-nonce">),
 *      emulating a nonce-aware site loader (e.g. Google Earth's own bootstrap)
 * In extension mode the hook additionally exposes chrome-extension:// WAR
 * URLs via window.__WASMonkeyExtBaseURL; step hookApiGetWabt/hookApiGetBinaryen
 * exercise that path when available.
 */
(function () {
  "use strict";

  var WAT = '(module (func (export "f") (result i32) i32.const 42))';

  function nonce() {
    var m = document.querySelector('meta[name="wm-nonce"]');
    return m ? m.getAttribute("content") : null;
  }

  function loadClassicScript(src, useNonce) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      if (useNonce && nonce()) s.setAttribute("nonce", nonce());
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error("script load failed/blocked: " + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
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

  window.__wmSpike = async function (profile) {
    var res = {
      profile: profile || "unknown",
      hookInstalled: !!window.__WASMonkeyInstalled,
      extBase: window.__WASMonkeyExtBaseURL || null,
      ua: navigator.userAgent,
      steps: [],
    };
    async function step(name, fn) {
      var t0 = Date.now();
      try {
        var detail = await fn();
        res.steps.push({ step: name, ok: true, ms: Date.now() - t0, detail: detail || null });
        return true;
      } catch (e) {
        res.steps.push({ step: name, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
        return false;
      }
    }

    // ---- wabt (UMD classic script) ----
    var wabtLoaded = await step("wabtScriptLoad", async function () {
      await loadClassicScript("/vendor/wabt/index.js", false);
      return "plain";
    });
    if (!wabtLoaded && nonce()) {
      wabtLoaded = await step("wabtScriptLoadWithNonce", async function () {
        await loadClassicScript("/vendor/wabt/index.js", true);
        return "nonce";
      });
    }
    if (typeof window.WabtModule === "function") {
      var wabt = null;
      if (await step("wabtInit", async function () { wabt = await window.WabtModule(); return "module ready"; })) {
        var wabtBinary = null;
        if (await step("wabtParseWat", async function () {
          var m = wabt.parseWat("spike.wat", WAT);
          wabtBinary = m.toBinary({});
          return wabtBinary.buffer.length + " bytes emitted";
        })) {
          await step("wabtOutputInstantiate", async function () {
            var inst = await WebAssembly.instantiate(wabtBinary.buffer, {});
            var v = inst.instance.exports.f();
            if (v !== 42) throw new Error("unexpected f() = " + v);
            return "f() = 42";
          });
        }
      }
    }

    // ---- Binaryen (ESM dynamic import, top-level await) ----
    var binaryen = null;
    if (await step("binaryenImport", async function () {
      var m = await import("/vendor/binaryen/index.js");
      binaryen = m.default || m;
      if (typeof binaryen.parseText !== "function") throw new Error("binaryen API missing parseText");
      return "ESM module initialized (embedded wasm compiled)";
    })) {
      var byBinary = null;
      if (await step("binaryenParseText", async function () {
        var mod = binaryen.parseText(WAT);
        byBinary = mod.emitBinary();
        var valid = mod.validate();
        return byBinary.length + " bytes emitted, validate()=" + valid;
      })) {
        await step("binaryenOutputInstantiate", async function () {
          var inst = await WebAssembly.instantiate(byBinary, {});
          var v = inst.instance.exports.f();
          if (v !== 42) throw new Error("unexpected f() = " + v);
          return "f() = 42";
        });
      }
    }

    // ---- hook lazy-load API (docs/feasibility.md §7.6 contract) ----
    if (window.__WASMonkey) {
      await step("hookApiGetWabt", async function () {
        var w = await window.__WASMonkey.getWabt();
        if (!w || typeof w.parseWat !== "function") throw new Error("getWabt() did not resolve a usable module");
        var m = w.parseWat("hook.wat", WAT);
        return "getWabt() ok, toBinary " + m.toBinary({}).buffer.length + " bytes";
      });
      await step("hookApiGetBinaryen", async function () {
        var b = await window.__WASMonkey.getBinaryen();
        if (!b || typeof b.parseText !== "function") throw new Error("getBinaryen() did not resolve a usable module");
        var mod = b.parseText(WAT);
        return "getBinaryen() ok, emitBinary " + mod.emitBinary().length + " bytes";
      });
    } else {
      res.steps.push({ step: "hookApiGetWabt", ok: false, error: "hook not installed" });
      res.steps.push({ step: "hookApiGetBinaryen", ok: false, error: "hook not installed" });
    }

    res.logs = (window.__WASMonkeyLogs || []).slice();
    return res;
  };

  function post(payload) {
    try { fetch("/collect", { method: "POST", body: JSON.stringify(payload) }); } catch (e) {}
  }

  // When the runner injects this file via CDP evaluate (profiles whose CSP
  // blocks script loading), it sets globalThis.__wmCdpDriven first and calls
  // window.__wmSpike(profile) itself — auto-run is suppressed.
  if (!globalThis.__wmCdpDriven) {
    var profile = profileFromCurrentScript();
    window.__wmSpike(profile).then(
      function (r) { post(Object.assign({ stage: "spike-done" }, r)); },
      function (err) { post({ stage: "error", profile: profile, message: String((err && err.message) || err) }); }
    );
    setTimeout(function () { post({ stage: "timeout", profile: profile }); }, 20000);
  }
})();
