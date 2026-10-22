(function (global) {
  "use strict";
  var TAG = "[wasMonkey-metadata]";

  function parseMetadata(code) {
    var meta = {
      name: null,
      match: [],
      exclude: [],
      runAt: "document-start",
      grants: [],
      version: null,
      code: code || "",
    };
    var m = /\/\/\s*==WasMonkeyScript==([\s\S]*?)\/\/\s*==\/WasMonkeyScript==/.exec(code || "");
    var block = m ? m[1] : "";
    var lines = block.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var mm = /^\/\/\s*@(\w+)\s*(.*)$/.exec(line);
      if (!mm) continue;
      var key = mm[1].toLowerCase();
      var val = mm[2].trim();
      if (key === "name") meta.name = val;
      else if (key === "match") { if (val) meta.match.push(val); }
      else if (key === "exclude") { if (val) meta.exclude.push(val); }
      else if (key === "run-at" || key === "runat") meta.runAt = val || meta.runAt;
      else if (key === "grant") { val.split(/[\s|]+/).forEach(function (g) { if (g) meta.grants.push(g); }); }
      else if (key === "grants") { val.split(/\s+/).forEach(function (g) { if (g) meta.grants.push(g); }); }
      else if (key === "version") meta.version = val;
    }
    if (!meta.name) meta.name = "Untitled script";
    if (meta.match.length === 0) meta.match.push("*");
    // de-dupe grants
    meta.grants = Array.from(new Set(meta.grants));
    return meta;
  }

  function globToRegex(pattern) {
    // Supports glob (* ?) and /regex/ literals.
    if (!pattern) return /^$/;
    if (pattern.charAt(0) === "/" && pattern.length > 2 && pattern.charAt(pattern.length - 1) === "/") {
      try { return new RegExp(pattern.slice(1, -1)); } catch (e) { /* fall through */ }
    }
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    escaped = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp("^" + escaped + "$");
  }

  function matchesUrl(patterns, url) {
    patterns = patterns || [];
    if (patterns.length === 0) return true;
    return patterns.some(function (p) {
      try { return globToRegex(p).test(url); } catch (e) { return false; }
    });
  }

  function scriptMatches(script, url) {
    if (!script || script.enabled === false) return false;
    var match = script.match || script.matchPatterns || [];
    var exclude = script.exclude || script.excludePatterns || [];
    if (match.length && !matchesUrl(match, url)) return false;
    if (exclude.length && matchesUrl(exclude, url)) return false;
    return true;
  }

  var api = {
    parseMetadata: parseMetadata,
    globToRegex: globToRegex,
    matchesUrl: matchesUrl,
    scriptMatches: scriptMatches,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  // Browser global (MAIN or ISOLATED world)
  try { global.wasMonkeyMetadata = api; } catch (e) {}
  try { if (typeof window !== "undefined") window.wasMonkeyMetadata = api; } catch (e) {}
  try { if (typeof self !== "undefined") self.wasMonkeyMetadata = api; } catch (e) {}
})(typeof globalThis !== "undefined" ? globalThis : this);
