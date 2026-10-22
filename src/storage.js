(function () {
  "use strict";
  // ISOLATED-world storage layer for WASMonkey scripts.
  // Exposes window.WASMonkeyStorage with CRUD + matching helpers.
  // Schema: chrome.storage.local key "scripts" -> WasmScript[]

  var TAG = "[WASMonkey-storage]";

  function genId() {
    return "wm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function now() { return Date.now(); }

  function getScripts(cb) {
    try {
      chrome.storage.local.get({ scripts: [] }, function (res) {
        cb(null, (res && res.scripts) || []);
      });
    } catch (e) { cb(e, []); }
  }

  function setScripts(scripts, cb) {
    try {
      chrome.storage.local.set({ scripts: scripts }, function () {
        if (chrome.runtime.lastError) cb && cb(chrome.runtime.lastError);
        else cb && cb(null);
      });
    } catch (e) { cb && cb(e); }
  }

  function addScript(script, cb) {
    script = script || {};
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err); return; }
      var meta = (typeof WASMonkeyMetadata !== "undefined" && WASMonkeyMetadata.parseMetadata)
        ? WASMonkeyMetadata.parseMetadata(script.code || "")
        : { name: script.name || "Untitled script", match: script.match || ["*"], exclude: script.exclude || [], runAt: script.runAt || "document-start", grants: script.grants || [], version: script.version || null };
      var s = {
        id: script.id || genId(),
        name: script.name || meta.name,
        match: script.match || meta.match,
        exclude: script.exclude || meta.exclude,
        code: script.code || "",
        enabled: script.enabled !== false,
        grants: script.grants || meta.grants,
        runAt: script.runAt || meta.runAt,
        version: script.version || meta.version,
        createdAt: script.createdAt || now(),
        updatedAt: now(),
      };
      scripts.push(s);
      setScripts(scripts, function (e) { cb && cb(e, s); });
    });
  }

  function updateScript(id, patch, cb) {
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err); return; }
      var idx = scripts.findIndex(function (s) { return s.id === id; });
      if (idx < 0) { cb && cb(new Error("script not found: " + id)); return; }
      patch = patch || {};
      var s = scripts[idx];
      if (patch.name != null) s.name = patch.name;
      if (patch.match != null) s.match = patch.match;
      if (patch.exclude != null) s.exclude = patch.exclude;
      if (patch.code != null) {
        s.code = patch.code;
        if (typeof WASMonkeyMetadata !== "undefined" && WASMonkeyMetadata.parseMetadata) {
          var meta = WASMonkeyMetadata.parseMetadata(s.code);
          if (!patch.name) s.name = meta.name;
          if (!patch.match) s.match = meta.match;
          if (!patch.exclude) s.exclude = meta.exclude;
          if (!patch.grants) s.grants = meta.grants;
          if (!patch.runAt) s.runAt = meta.runAt;
        }
      }
      if (patch.enabled != null) s.enabled = patch.enabled;
      if (patch.grants != null) s.grants = patch.grants;
      if (patch.runAt != null) s.runAt = patch.runAt;
      if (patch.version != null) s.version = patch.version;
      s.updatedAt = now();
      scripts[idx] = s;
      setScripts(scripts, function (e) { cb && cb(e, s); });
    });
  }

  function deleteScript(id, cb) {
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err); return; }
      var next = scripts.filter(function (s) { return s.id !== id; });
      setScripts(next, function (e) { cb && cb(e); });
    });
  }

  function toggleScript(id, enabled, cb) {
    updateScript(id, { enabled: enabled }, cb);
  }

  function listScriptsForUrl(url, cb) {
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err, []); return; }
      var md = (typeof WASMonkeyMetadata !== "undefined") ? WASMonkeyMetadata : null;
      var filtered = scripts.filter(function (s) {
        if (s.enabled === false) return false;
        if (md && md.scriptMatches) return md.scriptMatches(s, url);
        // fallback basic
        return true;
      });
      cb(null, filtered);
    });
  }

  function exportScripts(cb) {
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err); return; }
      cb(null, JSON.stringify(scripts, null, 2));
    });
  }

  function importScripts(json, cb) {
    var parsed;
    try { parsed = JSON.parse(json); } catch (e) { cb && cb(e); return; }
    if (!Array.isArray(parsed)) parsed = [parsed];
    getScripts(function (err, scripts) {
      if (err) { cb && cb(err); return; }
      parsed.forEach(function (s) {
        var meta = (typeof WASMonkeyMetadata !== "undefined" && WASMonkeyMetadata.parseMetadata && s.code)
          ? WASMonkeyMetadata.parseMetadata(s.code) : {};
        scripts.push({
          id: s.id || genId(),
          name: s.name || meta.name || "Imported script",
          match: s.match || meta.match || ["*"],
          exclude: s.exclude || meta.exclude || [],
          code: s.code || "",
          enabled: s.enabled !== false,
          grants: s.grants || meta.grants || [],
          runAt: s.runAt || meta.runAt || "document-start",
          version: s.version || meta.version || null,
          createdAt: s.createdAt || now(),
          updatedAt: now(),
        });
      });
      setScripts(scripts, function (e) { cb && cb(e, parsed.length); });
    });
  }

  var api = {
    getScripts: getScripts,
    setScripts: setScripts,
    addScript: addScript,
    updateScript: updateScript,
    deleteScript: deleteScript,
    toggleScript: toggleScript,
    listScriptsForUrl: listScriptsForUrl,
    exportScripts: exportScripts,
    importScripts: importScripts,
  };

  try { window.WASMonkeyStorage = api; } catch (e) {}
  try { if (typeof globalThis !== "undefined") globalThis.WASMonkeyStorage = api; } catch (e) {}
  console.log(TAG + " storage layer loaded");
})();
