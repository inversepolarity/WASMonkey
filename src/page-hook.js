(function () {
  "use strict";
  if (window.__WASMonkeyInstalled) return;
  window.__WASMonkeyInstalled = true;
  window.__WASMonkeyDisabled = false;
  window.__WASMonkeyErrors = window.__WASMonkeyErrors || [];
  window.__WASMonkeyExtBaseURL = window.__WASMonkeyExtBaseURL || null;
  window.__WASMonkeyWorkerHookURL = window.__WASMonkeyWorkerHookURL || null;
  function recordError(where, err) {
    try {
      var msg = "[WASMonkey] " + where + ": " + (err && err.message ? err.message : String(err));
      window.__WASMonkeyErrors.push({ where: where, message: msg, time: Date.now() });
      console.error(msg);
      // CSP-specific hint
      if (/Content Security Policy|wasm-unsafe-eval|CompileError/i.test(msg)) {
        console.warn("[WASMonkey] CSP may be blocking re-instantiation of patched bytes. Enable CSP relaxation in settings or reduce patching.");
      }
    } catch (e) {}
  }

  document.addEventListener("WASMonkey:ext-base", function (ev) {
    try {
      var d = JSON.parse((ev && ev.detail) || "{}");
      if (d.extBaseURL) window.__WASMonkeyExtBaseURL = d.extBaseURL;
      if (d.workerHookURL) window.__WASMonkeyWorkerHookURL = d.workerHookURL;
    } catch (e) {}
  });
  var TAG = "[WASMonkey]";
  // Cross-world (isolated bridge) control + script delivery channel.
  try {
    document.addEventListener("WASMonkey:disable", function () { window.__WASMonkeyDisabled = true; });
  } catch (e) {}

  var orig = {
    instantiate: WebAssembly.instantiate,
    instantiateStreaming: WebAssembly.instantiateStreaming,
    compile: WebAssembly.compile,
    compileStreaming: WebAssembly.compileStreaming,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
  };

  function bytesFromBufferSource(src) {
    if (src == null) return null;
    if (src instanceof Uint8Array) return src;
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    return null;
  }

  function stack() {
    try { throw new Error("wm-stack"); } catch (e) { return e && e.stack; }
  }

  function log(kind, bytes, sourceUrl) {
    if (window.__WASMonkeyDisabled) return;
    try {
      var msg = TAG + " " + kind + ": " + (bytes ? bytes.byteLength : "?") + " bytes" +
        (sourceUrl ? " (" + sourceUrl + ")" : "") +
        " | page: " + location.href;
      (window.__WASMonkeyLogs = window.__WASMonkeyLogs || []).push(msg);
      console.log(msg);
      if (window.__WASMonkeyRecordMode && bytes) {
        (async () => {
          try {
            var h = await window.__WASMonkey.hashBytes(bytes);
            console.log(TAG + " hash: " + h);
          } catch (e) {}
        })();
      }
      var s = stack();
      if (s) console.log(TAG + " stack:\n" + s.split("\n").slice(2, 8).join("\n"));
    } catch (e) {}
  }

  function readBytesFromResponseLike(src) {
    if (!src) return Promise.resolve({ bytes: null, url: null });
    if (typeof src.then === "function") {
      return src.then(function (r) {
        var u = (r && r.url) ? r.url : null;
        if (r && typeof r.clone === "function") {
          return r.clone().arrayBuffer().then(function (ab) { return { bytes: new Uint8Array(ab), url: u }; }).catch(function () { return { bytes: null, url: u }; });
        }
        var b = bytesFromBufferSource(r);
        if (b) return { bytes: b, url: u };
        if (r instanceof ArrayBuffer) return { bytes: new Uint8Array(r), url: u };
        return { bytes: null, url: u };
      }).catch(function () { return { bytes: null, url: null }; });
    }
    if (typeof src.clone === "function") {
      var u = src.url || null;
      return src.clone().arrayBuffer().then(function (ab) { return { bytes: new Uint8Array(ab), url: u }; }).catch(function () { return { bytes: null, url: u }; });
    }
    var b = bytesFromBufferSource(src);
    var u = (src && src.url) ? src.url : (typeof src === "string" ? src : null);
    return Promise.resolve({ bytes: b, url: u });
  }

  WebAssembly.instantiate = async function (source, imports) {
    var rest = Array.prototype.slice.call(arguments, 2);
    // Fast path: no hooks and quiet logging -> pass through without reading bytes.
    if (!beforeHooks.length && !afterHooks.length && window.__WASMonkeyLogVerbosity === "quiet") {
      var _r = await orig.instantiate.apply(WebAssembly, [source, imports].concat(rest));
      try {
        var _inst = _r && _r.instance ? _r.instance : _r;
        (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({
          byteLength: 0,
          url: location.href,
          exports: _inst && _inst.exports ? Object.keys(_inst.exports) : null,
          memorySize: null,
          tableSize: null,
        });
      } catch (e) {}
      rememberExportsForReplay(_r);
      return _r;
    }
    await awaitScriptsGrace();
    var r = await readBytesFromResponseLike(source).catch(function () { return { bytes: null, url: null }; });
    var bytes = r.bytes;
    var url = r.url;
    var ctx = { url: url || location.href, initiatorStack: (function () { try { throw new Error("s"); } catch (e) { return e.stack; } })(), byteLength: bytes ? bytes.byteLength : 0, frameUrl: location.href };
    if (bytes) log("instantiate", bytes, url);
    var patched = bytes;
    var useBytes = false;
    if (bytes && beforeHooks.length) {
      patched = await patchBytes(bytes, ctx);
      useBytes = !!(patched && patched !== bytes);
      if (useBytes) log("instantiate", patched, url + " (patched)");
    }
    var result;
    try {
      if (useBytes) {
        result = await orig.instantiate(patched, imports);
      } else {
        result = await orig.instantiate(source, imports);
      }
    } catch (e) {
      recordError("instantiate", e);
      if (useBytes) {
        try { result = await orig.instantiate(source, imports); } catch (e2) { recordError("instantiate-fallback", e2); throw e2; }
      } else {
        throw e;
      }
    }
    // track module for popup/inspector
    try {
      var memSize = null, tableSize = null;
      try {
        if (result && result.instance && result.instance.exports) {
          if (result.instance.exports.memory && result.instance.exports.memory.buffer) memSize = result.instance.exports.memory.buffer.byteLength;
          if (result.instance.exports.__indirect_function_table && result.instance.exports.__indirect_function_table.length != null) tableSize = result.instance.exports.__indirect_function_table.length;
        }
      } catch (e) {}
      (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({
        byteLength: (useBytes ? patched : bytes) ? (useBytes ? patched : bytes).byteLength : 0,
        url: url || location.href,
        exports: result && result.instance ? Object.keys(result.instance.exports) : null,
        memorySize: memSize,
        tableSize: tableSize,
      });
    } catch (e) {}
    rememberExportsForReplay(result);
    // after hooks
    if (afterHooks.length) {
      try {
        var exportsObj = result && result.instance ? result.instance.exports : (result && result.exports ? result.exports : result);
        for (var j = 0; j < afterHooks.length; j++) {
          try { afterHooks[j](exportsObj, ctx); } catch (e) { console.error("[WASMonkey] onAfterInstantiate threw:", e); }
        }
      } catch (e) {}
    }
    return result;
  };

  WebAssembly.instantiateStreaming = async function (source, imports) {
    var rest = Array.prototype.slice.call(arguments, 2);
    if (!beforeHooks.length && !afterHooks.length && window.__WASMonkeyLogVerbosity === "quiet") {
      var _r2 = await orig.instantiateStreaming.apply(WebAssembly, [source, imports].concat(rest));
      try {
        var _inst2 = _r2 && _r2.instance ? _r2.instance : _r2;
        (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({
          byteLength: 0,
          url: location.href,
          exports: _inst2 && _inst2.exports ? Object.keys(_inst2.exports) : null,
          memorySize: null,
          tableSize: null,
        });
      } catch (e) {}
      rememberExportsForReplay(_r2);
      return _r2;
    }
    await awaitScriptsGrace();
    var r = await readBytesFromResponseLike(source).catch(function () { return { bytes: null, url: null }; });
    var bytes = r.bytes;
    var url = r.url;
    var ctx = { url: url || location.href, initiatorStack: (function () { try { throw new Error("s"); } catch (e) { return e.stack; } })(), byteLength: bytes ? bytes.byteLength : 0, frameUrl: location.href };
    if (bytes) log("instantiateStreaming", bytes, url);
    var patched = bytes;
    var useBytes = false;
    if (bytes && beforeHooks.length) {
      patched = await patchBytes(bytes, ctx);
      useBytes = !!(patched && patched !== bytes);
      if (useBytes) log("instantiateStreaming", patched, url + " (patched)");
    }
    var result;
    try {
      if (useBytes) result = await orig.instantiate(patched, imports);
      else result = await orig.instantiateStreaming(source, imports);
    } catch (e) {
      recordError("instantiateStreaming", e);
      if (useBytes) {
        try { result = await orig.instantiateStreaming(source, imports); } catch (e2) { recordError("instantiateStreaming-fallback", e2); throw e2; }
      } else throw e;
    }
    if (afterHooks.length) {
      try {
        var exportsObj = result && result.instance ? result.instance.exports : (result && result.exports ? result.exports : result);
        for (var j = 0; j < afterHooks.length; j++) {
          try { afterHooks[j](exportsObj, ctx); } catch (e) { console.error("[WASMonkey] onAfterInstantiate threw:", e); }
        }
      } catch (e) {}
    }
    // track module for popup/inspector
    try {
      var memSize = null, tableSize = null;
      try {
        var inst = result && result.instance ? result.instance : result;
        if (inst && inst.exports) {
          if (inst.exports.memory && inst.exports.memory.buffer) memSize = inst.exports.memory.buffer.byteLength;
          if (inst.exports.__indirect_function_table && inst.exports.__indirect_function_table.length != null) tableSize = inst.exports.__indirect_function_table.length;
        }
      } catch (e) {}
      (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({
        byteLength: bytes ? bytes.byteLength : 0,
        url: url || location.href,
        exports: inst && inst.exports ? Object.keys(inst.exports) : null,
        memorySize: memSize,
        tableSize: tableSize,
      });
    } catch (e) {}
    rememberExportsForReplay(result);
    return result;
  };

  WebAssembly.compile = async function (source) {
    var rest = Array.prototype.slice.call(arguments, 1);
    if (!beforeHooks.length && !afterHooks.length && window.__WASMonkeyLogVerbosity === "quiet") {
      var _cfast = await orig.compile.apply(WebAssembly, [source].concat(rest));
      try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: 0, url: location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {}
      return _cfast;
    }
    await awaitScriptsGrace();
    var r = await readBytesFromResponseLike(source).catch(function () { return { bytes: null, url: null }; });
    var bytes = r.bytes;
    var url = r.url;
    if (bytes) log("compile", bytes, url);
    var patched = bytes;
    var useBytes = false;
    if (bytes && beforeHooks.length) {
      var ctx = { url: url || location.href, initiatorStack: null, byteLength: bytes.byteLength, frameUrl: location.href };
      patched = await patchBytes(bytes, ctx);
      useBytes = !!(patched && patched !== bytes);
      if (useBytes) log("compile", patched, url + " (patched)");
    }
    try {
      var _cr;
      if (useBytes) _cr = await orig.compile(patched);
      else _cr = await orig.compile(source);
      try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: bytes ? bytes.byteLength : 0, url: url || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {}
      return _cr;
    } catch (e) {
      recordError("compile", e);
      if (useBytes) {
        try { var _cr2 = await orig.compile(source); try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: bytes ? bytes.byteLength : 0, url: url || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {} return _cr2; } catch (e2) { recordError("compile-fallback", e2); throw e2; }
      }
      throw e;
    }
  };

  WebAssembly.compileStreaming = async function (source) {
    var rest = Array.prototype.slice.call(arguments, 1);
    if (!beforeHooks.length && !afterHooks.length && window.__WASMonkeyLogVerbosity === "quiet") {
      var _csfast = await orig.compileStreaming.apply(WebAssembly, [source].concat(rest));
      try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: 0, url: location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {}
      return _csfast;
    }
    await awaitScriptsGrace();
    var r = await readBytesFromResponseLike(source).catch(function () { return { bytes: null, url: null }; });
    var bytes = r.bytes;
    var url = r.url;
    if (bytes) log("compileStreaming", bytes, url);
    var patched = bytes;
    var useBytes = false;
    if (bytes && beforeHooks.length) {
      var ctx = { url: url || location.href, initiatorStack: null, byteLength: bytes.byteLength, frameUrl: location.href };
      patched = await patchBytes(bytes, ctx);
      useBytes = !!(patched && patched !== bytes);
      if (useBytes) { log("compileStreaming", patched, url + " (patched)"); }
    }
    try {
      var _cs;
      if (useBytes) _cs = await orig.compile(patched);
      else _cs = await orig.compileStreaming(source);
      try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: bytes ? bytes.byteLength : 0, url: url || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {}
      return _cs;
    } catch (e) {
      recordError("compileStreaming", e);
      if (useBytes) {
        try { var _cs2 = await orig.compileStreaming(source); try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: bytes ? bytes.byteLength : 0, url: url || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {} return _cs2; } catch (e2) { recordError("compileStreaming-fallback", e2); throw e2; }
      }
      throw e;
    }
  };

  function ModuleWrapper() {
    var args = Array.prototype.slice.call(arguments);
    try {
      var b = bytesFromBufferSource(args[0]);
      if (b) {
        var u = (args[0] && args[0].url) ? args[0].url : null;
        log("Module ctor", b, u);
        if (beforeHooks.length) {
          var ctx = { url: u || location.href, initiatorStack: null, byteLength: b.byteLength, frameUrl: location.href };
          var patched = b;
          var hooked = false;
          for (var i = 0; i < beforeHooks.length; i++) {
            try {
              // sync hook call (hooks may be async; fire-and-forget here)
              var res = beforeHooks[i](patched, ctx);
              if (res instanceof Uint8Array) { patched = res; hooked = true; }
            } catch (e) { console.error("[WASMonkey] onBeforeInstantiate threw:", e); }
          }
          if (hooked && patched && patched !== b) {
            log("Module ctor", patched, u + " (patched)");
            try { var _mp = new orig.Module(patched); try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: patched ? patched.byteLength : 0, url: u || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {} return _mp; }
            catch (e) { recordError("Module ctor", e); try { var _mb = new orig.Module(b); try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: b ? b.byteLength : 0, url: u || location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {} return _mb; } catch (e2) { recordError("Module ctor-fallback", e2); throw e2; } }
          }
        }
      }
    } catch (e) {}
    var _mfinal = new orig.Module(...args);
    try { (window.__WASMonkeyModules = window.__WASMonkeyModules || []).push({ byteLength: (typeof b !== "undefined" && b) ? b.byteLength : 0, url: (typeof u !== "undefined" && u) ? u : location.href, exports: null, memorySize: null, tableSize: null }); } catch (e) {}
    return _mfinal;
  }
  ModuleWrapper.prototype = orig.Module.prototype;
  Object.keys(orig.Module).forEach(function (k) {
    try { ModuleWrapper[k] = orig.Module[k]; } catch (e) {}
  });
  try { Object.defineProperty(ModuleWrapper, "name", { value: "Module" }); } catch (e) {}
  WebAssembly.Module = ModuleWrapper;

  function InstanceWrapper() {
    var args = Array.prototype.slice.call(arguments);
    var instance = new orig.Instance(...args);
    if (afterHooks.length) {
      try {
        var ctx = { url: location.href, initiatorStack: null, byteLength: 0, frameUrl: location.href };
        for (var i = 0; i < afterHooks.length; i++) {
          try { afterHooks[i](instance.exports, ctx); } catch (e) { console.error("[WASMonkey] onAfterInstantiate threw:", e); }
        }
      } catch (e) {}
    } else {
      rememberExportsForReplay(instance);
    }
    return instance;
  }
  InstanceWrapper.prototype = orig.Instance.prototype;
  Object.keys(orig.Instance).forEach(function (k) {
    try { InstanceWrapper[k] = orig.Instance[k]; } catch (e) {}
  });
  try { Object.defineProperty(InstanceWrapper, "name", { value: "Instance" }); } catch (e) {}
  WebAssembly.Instance = InstanceWrapper;

  // --- transitional API surface (Phase 0 follow-up) -----------------------
  // Base URL for web_accessible_resources when running as a real extension
  // content script; null under CDP injection / plain pages, in which case
  // vendor files resolve same-origin (the fixture server mirrors /vendor/).
  try {
    window.__WASMonkeyExtBaseURL =
      typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function"
        ? chrome.runtime.getURL("")
        : null;
  } catch (e) { window.__WASMonkeyExtBaseURL = null; }

  // Lazy-load contract reserved for Phase 4/5 (docs/feasibility.md §7.6):
  // getBinaryen() / getWabt() pull the vendored browser builds into the MAIN
  // world on demand instead of at document_start.
  var vendorP = {};
  function vendorBase() {
    return window.__WASMonkeyExtBaseURL || (location.origin ? location.origin + "/" : "/");
  }
  function getBinaryen() {
    if (!vendorP.binaryen) {
      vendorP.binaryen = import(vendorBase() + "vendor/binaryen/index.js")
        .then(function (m) { return m.default || m; })
        .catch(function (e) { vendorP.binaryen = null; throw e; });
    }
    return vendorP.binaryen;
  }
  function getWabt() {
    if (!vendorP.wabt) {
      vendorP.wabt = new Promise(function (resolve, reject) {
        if (typeof window.WabtModule === "function") { resolve(window.WabtModule()); return; }
        var s = document.createElement("script");
        s.src = vendorBase() + "vendor/wabt/index.js";
        s.onload = function () {
          try { resolve(window.WabtModule()); } catch (e) { reject(e); }
        };
        s.onerror = function () { reject(new Error("WASMonkey: wabt vendor script blocked or missing")); };
        (document.head || document.documentElement).appendChild(s);
      }).catch(function (e) { vendorP.wabt = null; throw e; });
    }
    return vendorP.wabt;
  }
  window.__WASMonkey = {
    version: "0.0.2",
    getBinaryen: getBinaryen,
    getWabt: getWabt,
    get logs() { return window.__WASMonkeyLogs || []; },
  };

  // Hook registries (populated by user scripts via WASMonkey API).
  var beforeHooks = [];
  var afterHooks = [];
  var currentGrants = [];

  // Modules are often instantiated at document_start, before the isolated
  // bridge has handed our user scripts over (see the delivery comment further
  // down). Instances created in that window are remembered (bounded) so that
  // onAfterInstantiate hooks still see their exports once the scripts land.
  var _preDeliveryExports = [];
  var PRE_DELIVERY_REPLAY_LIMIT = 4;
  function rememberExportsForReplay(result) {
    try {
      if (_scriptsDelivered || afterHooks.length) return;
      if (_preDeliveryExports.length >= PRE_DELIVERY_REPLAY_LIMIT) return;
      var exp = result && result.instance ? result.instance.exports
        : (result && result.exports ? result.exports : null);
      if (exp) _preDeliveryExports.push(exp);
    } catch (e) {}
  }

  // Startup grace: the very first instantiation on a page usually happens
  // before the isolated bridge has answered (storage round-trip), and a
  // onBeforeInstantiate hook can only patch bytes it was awake for. The first
  // async entry point therefore waits a short, bounded moment for the script
  // payload instead of letting that module slip through unhooked.
  // Override with chrome.storage.local { startupGraceMs: 0 } to opt out.
  var _scriptsReadyCallbacks = [];
  var _startupGraceUsed = false;
  function signalScriptsReady() {
    var cbs = _scriptsReadyCallbacks.splice(0, _scriptsReadyCallbacks.length);
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](); } catch (e) {}
    }
  }
  function awaitScriptsGrace() {
    if (_scriptsDelivered || _startupGraceUsed) return Promise.resolve();
    _startupGraceUsed = true;
    var ms = (typeof window.__WASMonkeyStartupGraceMs === "number") ? window.__WASMonkeyStartupGraceMs : 300;
    if (ms <= 0) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(); }
      _scriptsReadyCallbacks.push(finish);
      setTimeout(finish, ms);
    });
  }

  // IndexedDB patch cache (Phase 9).
  var _cacheDB = null;
  function openPatchCache() {
    if (_cacheDB) return Promise.resolve(_cacheDB);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open("WASMonkeyCache", 1);
        req.onupgradeneeded = function () { try { req.result.createObjectStore("patches"); } catch (e) {} };
        req.onsuccess = function () { _cacheDB = req.result; resolve(_cacheDB); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  async function cacheGet(key) {
    var db = await openPatchCache();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction("patches", "readonly");
        var r = tx.objectStore("patches").get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  async function cacheSet(key, bytes) {
    var db = await openPatchCache();
    if (!db) return;
    try {
      var tx = db.transaction("patches", "readwrite");
      tx.objectStore("patches").put(bytes.buffer ? bytes.buffer : bytes, key);
    } catch (e) {}
  }
  async function patchBytes(bytes, ctx) {
    // Fast path: no hooks registered -> no patching, no caching.
    if (!beforeHooks.length) return bytes;
    // Hash
    var hash = "";
    try { hash = await window.__WASMonkey.hashBytes(bytes); } catch (e) {}
    var version = (typeof window.__WASMonkeyScriptVersion === "string") ? window.__WASMonkeyScriptVersion : "0";
    var key = hash + ":" + version;
    // Cache check
    var cached = await cacheGet(key);
    if (cached) {
      try { return new Uint8Array(cached); } catch (e) {}
    }
    // Run hooks
    var patched = bytes;
    for (var i = 0; i < beforeHooks.length; i++) {
      try {
        var res = await beforeHooks[i](patched, ctx);
        if (res instanceof Uint8Array) patched = res;
      } catch (e) { recordError("onBeforeInstantiate", e); }
    }
    // Cache if changed
    if (patched && patched !== bytes) {
      cacheSet(key, patched).catch(function () {});
    }
    return patched;
  }

  var _binaryenCache = null;
  var _wabtCache = null;
  function _extBase() {
    if (typeof window.__WASMonkeyExtBaseURL === "string") return window.__WASMonkeyExtBaseURL;
    return null;
  }
  function loadBinaryen() {
    if (_binaryenCache) return Promise.resolve(_binaryenCache);
    var base = _extBase();
    var url = base ? base + "vendor/binaryen/index.js" : "/vendor/binaryen/index.js";
    return import(url).then(function (m) {
      _binaryenCache = m.default || m;
      return _binaryenCache;
    }).catch(function (e) {
      console.error("[WASMonkey] failed to load Binaryen:", e);
      return null;
    });
  }
  function loadWabt() {
    if (_wabtCache) return Promise.resolve(_wabtCache);
    var base = _extBase();
    var url = base ? base + "vendor/wabt/index.js" : "/vendor/wabt/index.js";
    return new Promise(function (resolve) {
      if (typeof window.WabtModule === "function") {
        window.WabtModule().then(function (m) { _wabtCache = m; resolve(m); }).catch(function (e) { console.error(e); resolve(null); });
        return;
      }
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () {
        window.WabtModule().then(function (m) { _wabtCache = m; resolve(m); }).catch(function (e) { console.error(e); resolve(null); });
      };
      s.onerror = function (e) { console.error("[WASMonkey] failed to load wabt:", e); resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function makeWASMonkeyAPI(script, resolvedGrants) {
    // Grants may come from the stored script record or from the
    // `// @grant` lines in its code header; callers pass the union.
    var grants = Array.isArray(resolvedGrants) ? resolvedGrants : ((script && script.grants) || []);
    return {
      apiVersion: 1,
      log: function () { console.log.apply(console, ["[WASMonkey:" + ((script && script.name) || "script") + "]"].concat(Array.prototype.slice.call(arguments))); },
      getBinaryen: function () { return loadBinaryen(); },
      getWabt: function () { return loadWabt(); },
      disassemble: function () { return Promise.resolve(""); },
      assemble: function () { return Promise.resolve(new Uint8Array()); },
      hashBytes: async function (bytes) {
        try {
          var h = await crypto.subtle.digest("SHA-256", bytes);
          return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        } catch (e) { return ""; }
      },
      onBeforeInstantiate: function (cb) {
        if (grants.indexOf("patchBytes") < 0) {
          console.warn("[WASMonkey] script '" + (script && script.name) + "' lacks @grant patchBytes; onBeforeInstantiate ignored.");
          return;
        }
        if (typeof cb === "function") beforeHooks.push(cb);
      },
      onAfterInstantiate: function (cb) {
        if (grants.indexOf("patchExports") < 0 && grants.indexOf("patchBytes") < 0) {
          console.warn("[WASMonkey] script '" + (script && script.name) + "' lacks @grant patchExports; onAfterInstantiate ignored.");
          return;
        }
        if (typeof cb === "function") afterHooks.push(cb);
      },
      storage: {
        get: function (key) { try { var v = localStorage.getItem("wm:" + (script && script.id) + ":" + key); return Promise.resolve(v ? JSON.parse(v) : null); } catch (e) { return Promise.resolve(null); } },
        set: function (key, val) { try { localStorage.setItem("wm:" + (script && script.id) + ":" + key, JSON.stringify(val)); } catch (e) {} return Promise.resolve(); },
      },
      utils: (typeof WASMonkeyUtils !== "undefined") ? WASMonkeyUtils : null,
    };
  }

  // --- Phase 2: user-script delivery --------------------------------------
  // The isolated bridge serializes the scripts matching this URL and hands them
  // over on the "WASMonkey:scripts" document event. This has to survive BOTH
  // injection orders:
  //
  //   Chrome  - MAIN and ISOLATED content scripts are installed as part of one
  //             document_start batch, before any page code runs.
  //   Firefox - document_start scripts defined in different manifest entries
  //             are evaluated one after the other. This file (MAIN) finishes
  //             first, so a one-shot request dispatched here is gone before
  //             isolated-bridge.js has registered its listener, and no script
  //             ever arrives.
  //
  // So: re-request with backoff across DOMContentLoaded/load, and the bridge
  // also pushes proactively once it starts up. Whichever side runs last closes
  // the gap.
  window.__WASMonkeyScripts = [];

  var _scriptRequestTimers = [];
  var _scriptsDelivered = false;
  var _appliedScriptKeys = Object.create(null);

  function grantsFromHeader(code) {
    var out = [];
    var re = /^[ \t]*\/\/[ \t]*@grant[ \t]+(.+)$/gm;
    var m;
    while ((m = re.exec(code || "")) !== null) {
      String(m[1]).trim().split(/[\s|,]+/).forEach(function (g) {
        if (g && out.indexOf(g) < 0) out.push(g);
      });
    }
    return out;
  }

  function resolveGrants(script) {
    var grants = Array.isArray(script && script.grants) ? script.grants.slice() : [];
    var fromCode = [];
    try {
      if (typeof WASMonkeyMetadata !== "undefined" && WASMonkeyMetadata.parseMetadata) {
        fromCode = WASMonkeyMetadata.parseMetadata((script && script.code) || "").grants || [];
      } else {
        fromCode = grantsFromHeader(script && script.code);
      }
    } catch (e) { fromCode = []; }
    fromCode.forEach(function (g) { if (grants.indexOf(g) < 0) grants.push(g); });
    return grants;
  }

  function applyScripts(scripts) {
    var applied = 0;
    scripts.forEach(function (script) {
      if (!script || script.enabled === false) return;
      var key = String(script.id || script.name || "anon") + ":" +
        String(script.updatedAt || script.version || script.createdAt || 0);
      if (_appliedScriptKeys[key]) return;
      _appliedScriptKeys[key] = true;
      currentGrants = resolveGrants(script);
      var api = makeWASMonkeyAPI(script, currentGrants);
      window.WASMonkey = api;
      window.wasMonkey = api;
      try {
        var fn = new Function("WASMonkey, wasMonkey", script.code || "");
        fn(api, api);
        applied++;
      } catch (e) {
        console.error("[WASMonkey] script '" + (script.name || script.id) + "' threw:", e);
      }
    });
    currentGrants = [];
    if (applied) console.log(TAG + " " + applied + " script(s) applied");

    // Replay exports of modules instantiated before the scripts arrived.
    if (applied && afterHooks.length && _preDeliveryExports.length) {
      var replay = _preDeliveryExports.slice();
      _preDeliveryExports.length = 0;
      console.log(TAG + " replaying onAfterInstantiate for " + replay.length + " module(s) created before delivery");
      replay.forEach(function (exportsObj) {
        var rctx = { url: location.href, initiatorStack: null, byteLength: 0, frameUrl: location.href, replayed: true };
        for (var k = 0; k < afterHooks.length; k++) {
          try { afterHooks[k](exportsObj, rctx); } catch (e) { console.error("[WASMonkey] onAfterInstantiate threw:", e); }
        }
      });
    }
    return applied;
  }

  function stopScriptRequests() {
    for (var i = 0; i < _scriptRequestTimers.length; i++) {
      try { clearTimeout(_scriptRequestTimers[i]); } catch (e) {}
    }
    _scriptRequestTimers = [];
  }

  function requestScripts() {
    try {
      document.dispatchEvent(new CustomEvent("WASMonkey:request-scripts", { detail: location.href }));
    } catch (e) {}
  }

  function handleScriptsPayload(payload) {
    var scripts = [];
    var version = "0";
    try {
      var parsed = typeof payload === "string" ? JSON.parse(payload || "[]") : payload;
      if (Array.isArray(parsed)) { scripts = parsed; }
      else if (parsed && Array.isArray(parsed.scripts)) { scripts = parsed.scripts; version = parsed.version || "0"; }
    } catch (e) { scripts = []; }
    window.__WASMonkeyScripts = scripts;
    window.__WASMonkeyScriptVersion = version;
    if (!_scriptsDelivered) {
      _scriptsDelivered = true;
      stopScriptRequests();
      signalScriptsReady();
    }
    return applyScripts(scripts);
  }

  document.addEventListener("WASMonkey:scripts", function (ev) {
    handleScriptsPayload(ev && ev.detail);
  });

  function scheduleScriptRequests() {
    if (_scriptsDelivered) return;
    var delays = [0, 40, 120, 300, 700, 1500, 3000];
    for (var i = 0; i < delays.length; i++) {
      _scriptRequestTimers.push(setTimeout(function () {
        if (!_scriptsDelivered) requestScripts();
      }, delays[i]));
    }
    ["DOMContentLoaded", "load", "pageshow"].forEach(function (type) {
      try {
        document.addEventListener(type, function () {
          if (!_scriptsDelivered) requestScripts();
        }, { once: true });
      } catch (e) {}
    });
    setTimeout(function () {
      if (!_scriptsDelivered) {
        // Nothing is coming: stop pinning instance exports for a replay.
        _preDeliveryExports.length = 0;
        console.warn(TAG + " no script payload received from the isolated bridge; user scripts are NOT active on this page. " +
          "Reload the tab; if it persists, check that the extension has access to this site and is not disabled here.");
      }
    }, 3600);
  }

  // Manual re-sync from the console: __WASMonkeyRefreshScripts()
  window.__WASMonkeyRefreshScripts = function () {
    _scriptsDelivered = false;
    stopScriptRequests();
    scheduleScriptRequests();
    return true;
  };

  scheduleScriptRequests();

  // Service Worker registration wrapping (Phase 6 groundwork).
  (function () {
    if (!navigator || !navigator.serviceWorker || typeof navigator.serviceWorker.register !== "function") return;
    var origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (scriptURL, options) {
      // Best-effort: full blob rewrite for service workers is deferred
      // (caching/update semantics need care). Pass through to original.
      return origRegister(scriptURL, options);
    };
  })();

  // Worker support (Phase 1/6 groundwork): wrap dedicated Worker constructor
  // to prepend worker-hook.js into the worker script via a blob URL.
  (function () {
    if (typeof Worker === "undefined") return;
    var OrigWorker = Worker;
    var workerHookText = null;
    function loadHookText() {
      if (workerHookText !== null) return workerHookText;
      try {
        var hookUrl = (typeof window.__WASMonkeyWorkerHookURL === "string") ? window.__WASMonkeyWorkerHookURL : "src/worker-hook.js";
        var xhr = new XMLHttpRequest();
        xhr.open("GET", hookUrl, false);
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) workerHookText = xhr.responseText || "";
      } catch (e) { workerHookText = ""; }
      if (workerHookText === null) workerHookText = "";
      return workerHookText;
    }
    function WorkerWrapper(scriptURL, options) {
      try {
        var hook = loadHookText();
        if (hook) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", scriptURL, false);
          xhr.send();
          if (xhr.status === 200 || xhr.status === 0) {
            var combined = hook + "\\n" + (xhr.responseText || "");
            var blob = new Blob([combined], { type: "application/javascript" });
            var url = URL.createObjectURL(blob);
            var w = new OrigWorker(url, options);
            // Revoke after a tick to allow worker to fetch the blob.
            setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
            return w;
          }
        }
      } catch (e) {
        // Fall through to original construction.
      }
      return new OrigWorker(scriptURL, options);
    }
    WorkerWrapper.prototype = OrigWorker.prototype;
    Object.keys(OrigWorker).forEach(function (k) { try { WorkerWrapper[k] = OrigWorker[k]; } catch (e) {} });
    try { Object.defineProperty(WorkerWrapper, "name", { value: "Worker" }); } catch (e) {}
    window.Worker = WorkerWrapper;
  })();

  // Global API surface for scripts and tooling (Phase 4/5 contract).
  window.__WASMonkey = {
    apiVersion: 1,
    log: function () { console.log.apply(console, ["[WASMonkey]"].concat(Array.prototype.slice.call(arguments))); },
    getBinaryen: loadBinaryen,
    getWabt: loadWabt,
    disassemble: async function (bytes) {
      var w = await loadWabt();
      if (!w) return "";
      try {
        var m = w.readWasm(bytes, { readDebugNames: true });
        return m.toText({ foldExprs: false });
      } catch (e) { return ""; }
    },
    assemble: async function (wat) {
      var w = await loadWabt();
      if (!w) return new Uint8Array();
      try {
        var m = w.parseWat("input.wat", wat);
        return new Uint8Array(m.toBinary({}).buffer);
      } catch (e) { return new Uint8Array(); }
    },
    hashBytes: async function (bytes) {
      try {
        var h = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      } catch (e) { return ""; }
    },
    onBeforeInstantiate: function (cb) { if (typeof cb === "function") beforeHooks.push(cb); },
    onAfterInstantiate: function (cb) { if (typeof cb === "function") afterHooks.push(cb); },
    storage: {
      get: function (key) { try { var v = localStorage.getItem("wm:global:" + key); return Promise.resolve(v ? JSON.parse(v) : null); } catch (e) { return Promise.resolve(null); } },
      set: function (key, val) { try { localStorage.setItem("wm:global:" + key, JSON.stringify(val)); } catch (e) {} return Promise.resolve(); },
    },
    utils: (typeof WASMonkeyUtils !== "undefined") ? WASMonkeyUtils : null,
  };

  console.log(TAG + " hook installed (page-hook.js)");
})();
