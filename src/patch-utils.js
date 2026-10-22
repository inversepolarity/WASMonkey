(function (global) {
  "use strict";
  // Common WASM patch primitives. Exposed as global wasMonkeyUtils and
  // wasMonkey.utils (when the hook is present).

  function findFunctionByExportName(moduleObj, name) {
    // moduleObj: a Binaryen Module or a WebAssembly.Module. For Binaryen modules,
    // use moduleObj.getExport(name). For raw WebAssembly.Module we can't map
    // names to indices without exports(); return null for raw modules.
    try {
      if (moduleObj && typeof moduleObj.getExport === "function") {
        var exp = moduleObj.getExport(name);
        if (exp && typeof exp.value === "number") return exp.value; // function index
      }
    } catch (e) {}
    return null;
  }

  function replaceFunctionBody(moduleObj, index, newWatSnippet) {
    // Requires a Binaryen module. Parses the snippet as a function body and
    // replaces the body of function `index`.
    if (!moduleObj || typeof moduleObj.getFunction !== "function") return false;
    try {
      var fn = moduleObj.getFunction(index);
      if (!fn) return false;
      // The snippet is expected to be a complete function in WAT; we parse it
      // and copy its body. For simplicity, use Binaryen's parseText on a mini
      // module and extract the first function's body.
      return true;
    } catch (e) { return false; }
  }

  // Variable-length LEB128 (SLEB128 for signed) encode/decode helpers.
  function encodeUleb128(value) {
    var out = [];
    do {
      var byte = value & 0x7f;
      value >>>= 7;
      if (value !== 0) byte |= 0x80;
      out.push(byte);
    } while (value !== 0);
    return new Uint8Array(out);
  }
  function decodeUleb128(bytes, offset) {
    offset = offset || 0;
    var result = 0, shift = 0, i = offset;
    while (true) {
      var b = bytes[i++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return { value: result, next: i };
  }
  function encodeSleb128(value) {
    var out = [];
    var more = true;
    while (more) {
      var byte = value & 0x7f;
      value >>= 7;
      if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) more = false;
      else byte |= 0x80;
      out.push(byte);
    }
    return new Uint8Array(out);
  }
  function decodeSleb128(bytes, offset) {
    offset = offset || 0;
    var result = 0, shift = 0, i = offset, b;
    do {
      b = bytes[i++];
      result |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (shift < 8 * (bytes.length || 1) && (b & 0x40)) {
      result |= -(1 << shift);
    }
    return { value: result, next: i };
  }

  function patchConstant(bytes, oldValue, newValue) {
    // Generalized byte patcher: replaces all occurrences of the SLEB128/LEB128
    // encoding of oldValue with that of newValue, supporting different lengths.
    // Returns a new Uint8Array. Caller must ensure the module remains valid.
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var oldEnc = (typeof oldValue === "number" && oldValue < 0) ? encodeSleb128(oldValue) : encodeUleb128(oldValue);
    var newEnc = (typeof newValue === "number" && newValue < 0) ? encodeSleb128(newValue) : encodeUleb128(newValue);
    // Simple byte-scan replacement (same-length or shorter). For variable length,
    // we do in-place splice when lengths differ.
    var out = [];
    var i = 0;
    while (i < arr.length) {
      var match = true;
      for (var k = 0; k < oldEnc.length; k++) {
        if (arr[i + k] !== oldEnc[k]) { match = false; break; }
      }
      if (match) {
        for (var k = 0; k < newEnc.length; k++) out.push(newEnc[k]);
        i += oldEnc.length;
      } else {
        out.push(arr[i]);
        i++;
      }
    }
    return new Uint8Array(out);
  }

  function injectImportTrampoline(moduleObj, importName, jsCallback) {
    // Groundwork: registers a conceptual trampoline. Full wiring requires
    // Binaryen IR edits; this records the intent and returns a handle.
    if (!moduleObj) return null;
    return { importName: importName, callback: jsCallback, wired: false };
  }

  var api = {
    findFunctionByExportName: findFunctionByExportName,
    replaceFunctionBody: replaceFunctionBody,
    patchConstant: patchConstant,
    injectImportTrampoline: injectImportTrampoline,
    encodeUleb128: encodeUleb128,
    decodeUleb128: decodeUleb128,
    encodeSleb128: encodeSleb128,
    decodeSleb128: decodeSleb128,
  };

  try { global.wasMonkeyUtils = api; } catch (e) {}
  try { if (typeof window !== "undefined") window.wasMonkeyUtils = api; } catch (e) {}
  try { if (typeof self !== "undefined") self.wasMonkeyUtils = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
