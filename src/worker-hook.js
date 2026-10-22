(function () {
  "use strict";
  if (self.__wasMonkeyInstalled) return;
  self.__wasMonkeyInstalled = true;
  var TAG = "[wasMonkey-worker]";

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

  function log(kind, bytes) {
    try {
      var msg = TAG + " " + kind + ": " + (bytes ? bytes.byteLength : "?") + " bytes | worker: " + (self.location && self.location.href);
      (self.__wasMonkeyLogs = self.__wasMonkeyLogs || []).push(msg);
      console.log(msg);
    } catch (e) {}
  }

  function readBytesFromResponseLike(src) {
    if (!src) return Promise.resolve(null);
    if (typeof src.then === "function") {
      return src.then(function (r) {
        if (r && typeof r.clone === "function") {
          return r.clone().arrayBuffer().then(function (ab) { return new Uint8Array(ab); }).catch(function () { return null; });
        }
        var b = bytesFromBufferSource(r);
        if (b) return b;
        if (r instanceof ArrayBuffer) return new Uint8Array(r);
        return null;
      }).catch(function () { return null; });
    }
    if (typeof src.clone === "function") {
      return src.clone().arrayBuffer().then(function (ab) { return new Uint8Array(ab); }).catch(function () { return null; });
    }
    var b = bytesFromBufferSource(src);
    return Promise.resolve(b);
  }

  WebAssembly.instantiate = function (source, imports) {
    var rest = Array.prototype.slice.call(arguments, 2);
    readBytesFromResponseLike(source).then(function (b) { if (b) log("instantiate", b); }).catch(function () {});
    return orig.instantiate.apply(WebAssembly, [source, imports].concat(rest));
  };
  WebAssembly.instantiateStreaming = function (source, imports) {
    var rest = Array.prototype.slice.call(arguments, 2);
    readBytesFromResponseLike(source).then(function (b) { if (b) log("instantiateStreaming", b); }).catch(function () {});
    return orig.instantiateStreaming.apply(WebAssembly, [source, imports].concat(rest));
  };
  WebAssembly.compile = function (source) {
    var rest = Array.prototype.slice.call(arguments, 1);
    readBytesFromResponseLike(source).then(function (b) { if (b) log("compile", b); }).catch(function () {});
    return orig.compile.apply(WebAssembly, [source].concat(rest));
  };
  WebAssembly.compileStreaming = function (source) {
    var rest = Array.prototype.slice.call(arguments, 1);
    readBytesFromResponseLike(source).then(function (b) { if (b) log("compileStreaming", b); }).catch(function () {});
    return orig.compileStreaming.apply(WebAssembly, [source].concat(rest));
  };
  function ModuleWrapper() {
    var args = Array.prototype.slice.call(arguments);
    try {
      var b = bytesFromBufferSource(args[0]);
      if (b) log("Module ctor", b);
    } catch (e) {}
    return new orig.Module(...args);
  }
  ModuleWrapper.prototype = orig.Module.prototype;
  Object.keys(orig.Module).forEach(function (k) { try { ModuleWrapper[k] = orig.Module[k]; } catch (e) {} });
  try { Object.defineProperty(ModuleWrapper, "name", { value: "Module" }); } catch (e) {}
  WebAssembly.Module = ModuleWrapper;

  function InstanceWrapper() {
    var args = Array.prototype.slice.call(arguments);
    return new orig.Instance(...args);
  }
  InstanceWrapper.prototype = orig.Instance.prototype;
  Object.keys(orig.Instance).forEach(function (k) { try { InstanceWrapper[k] = orig.Instance[k]; } catch (e) {} });
  try { Object.defineProperty(InstanceWrapper, "name", { value: "Instance" }); } catch (e) {}
  WebAssembly.Instance = InstanceWrapper;

  console.log(TAG + " hook installed (worker-hook.js)");
})();
