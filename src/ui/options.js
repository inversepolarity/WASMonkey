import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";

const STORAGE_KEY = null; // use chrome.storage

let editor = null;
let currentId = null;

function $(id) { return document.getElementById(id); }

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-" + name).classList.remove("hidden");
  document.querySelectorAll("nav button.nav").forEach(b => b.classList.toggle("active", b.dataset.view === name));
}

document.querySelectorAll("nav button.nav").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

function storage() { return (typeof chrome !== "undefined" && chrome.storage) ? chrome.storage.local : null; }

function getScripts(cb) {
  if (!storage()) { cb([]); return; }
  storage().get({ scripts: [] }, (res) => cb((res && res.scripts) || []));
}

function setScripts(scripts, cb) {
  if (!storage()) { cb && cb(); return; }
  storage().set({ scripts: scripts }, () => cb && cb());
}

function renderList() {
  getScripts((scripts) => {
    const tbody = $("script-list").querySelector("tbody");
    tbody.innerHTML = "";
    scripts.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escape(s.name)}</td><td>${escape((s.match||[]).join(" "))}</td><td><input type="checkbox" ${s.enabled!==false?"checked":""} data-id="${s.id}"></td><td>${new Date(s.updatedAt||s.createdAt||0).toLocaleString()}</td><td><button data-edit="${s.id}">Edit</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        getScripts((scripts) => {
          const s = scripts.find(x => x.id === id);
          if (s) { s.enabled = cb.checked; s.updatedAt = Date.now(); setScripts(scripts, renderList); }
        });
      });
    });
    tbody.querySelectorAll("button[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => editScript(btn.dataset.edit));
    });
  });
}

function escape(s) { return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const DEFAULT_CODE = `// ==WASMonkeyScript==
// @name        My script
// @match       *
// @grant       patchBytes
// ==/WASMonkeyScript==

WASMonkey.log("hello from WASMonkey script");

WASMonkey.onBeforeInstantiate((bytes, ctx) => {
  WASMonkey.log("intercepted", bytes.byteLength, "bytes");
  return bytes; // return patched bytes (or original to pass through)
});

WASMonkey.onAfterInstantiate((exports, ctx) => {
  WASMonkey.log("exports:", Object.keys(exports));
});
`;

function editScript(id) {
  getScripts((scripts) => {
    const s = id ? scripts.find(x => x.id === id) : null;
    currentId = s ? s.id : null;
    $("meta-name").value = s ? s.name : "";
    $("meta-match").value = s ? (s.match||[]).join(" ") : "*";
    $("meta-exclude").value = s ? (s.exclude||[]).join(" ") : "";
    $("meta-grant").value = s ? (s.grants||[]).join(" ") : "patchBytes";
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: s ? s.code : DEFAULT_CODE } });
    showView("editor");
  });
}

async function updateChecksum() {
  try {
    const bytes = new TextEncoder().encode(editor.state.doc.toString());
    const h = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    $("checksum").textContent = "sha256:" + hex.slice(0, 12) + "…";
  } catch (e) {}
}

function collectMeta() {
  return {
    name: $("meta-name").value.trim() || "Untitled script",
    match: $("meta-match").value.trim().split(/\s+/).filter(Boolean),
    exclude: $("meta-exclude").value.trim().split(/\s+/).filter(Boolean),
    grants: $("meta-grant").value.trim().split(/\s+/).filter(Boolean),
    code: editor.state.doc.toString(),
  };
}

function saveScript(reload) {
  const meta = collectMeta();
  getScripts((scripts) => {
    if (currentId) {
      const s = scripts.find(x => x.id === currentId);
      if (s) {
        s.name = meta.name; s.match = meta.match.length ? meta.match : ["*"];
        s.exclude = meta.exclude; s.grants = meta.grants; s.code = meta.code;
        s.updatedAt = Date.now();
      }
    } else {
      const s = {
        id: "wm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,6),
        name: meta.name,
        match: meta.match.length ? meta.match : ["*"],
        exclude: meta.exclude,
        code: meta.code,
        enabled: true,
        grants: meta.grants,
        runAt: "document-start",
        version: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      scripts.push(s);
      currentId = s.id;
    }
    setScripts(scripts, () => {
      renderList();
      showView("scripts");
      if (reload) {
        chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
          const target = (tabs && tabs.length) ? tabs[tabs.length - 1] : null;
          if (target) { chrome.tabs.reload(target.id); return; }
          chrome.tabs.query({ active: true, currentWindow: true }, (t2) => {
            if (t2 && t2[0] && !/^chrome-extension:|^about:|^moz-extension:/i.test(t2[0].url || "")) {
              chrome.tabs.reload(t2[0].id);
            }
          });
        });
      }
    });
  });
}

$("save-script").addEventListener("click", () => saveScript(false));
$("save-reload").addEventListener("click", () => saveScript(true));
$("delete-script").addEventListener("click", () => {
  if (!currentId) return;
  getScripts((scripts) => {
    const next = scripts.filter(s => s.id !== currentId);
    setScripts(next, () => { currentId = null; renderList(); showView("scripts"); });
  });
});
$("new-script").addEventListener("click", () => editScript(null));
$("new-from-template").addEventListener("click", () => {
  const choice = prompt("Template: logger / export-wrapper / byte-patcher");
  const templates = {
    "logger": `// ==WASMonkeyScript==\n// @name        Logger\n// @match       *\n// @grant       patchBytes\n// ==/WASMonkeyScript==\n\nWASMonkey.onBeforeInstantiate((bytes, ctx) => {\n  WASMonkey.log("WASM load", bytes.byteLength, "bytes at", ctx.url);\n  return bytes;\n});\n`,
    "export-wrapper": `// ==WASMonkeyScript==\n// @name        Export wrapper\n// @match       *\n// @grant       patchBytes patchExports\n// ==/WASMonkeyScript==\n\nWASMonkey.onAfterInstantiate((exports, ctx) => {\n  if (exports && typeof exports.add === "function") {\n    const orig = exports.add;\n    exports.add = function (a, b) { WASMonkey.log("add called", a, b); return orig(a, b); };\n  }\n});\n`,
    "byte-patcher": `// ==WASMonkeyScript==\n// @name        Byte patcher\n// @match       *\n// @grant       patchBytes\n// ==/WASMonkeyScript==\n\nWASMonkey.onBeforeInstantiate((bytes, ctx) => {\n  // Example: return bytes unmodified. Modify with Binaryen for real patches.\n  return bytes;\n});\n`,
  };
  const code = templates[choice];
  if (code) {
    editScript(null);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
  }
});

$("import-scripts").addEventListener("click", () => {
  const json = prompt("Paste scripts JSON:");
  if (!json) return;
  // Use storage module via chrome.storage directly: parse and append.
  try {
    const parsed = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    getScripts((scripts) => {
      arr.forEach(s => scripts.push(Object.assign({
        id: "wm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,6),
        enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
      }, s)));
      setScripts(scripts, renderList);
    });
  } catch (e) { alert("Invalid JSON: " + e.message); }
});

$("import-from-url").addEventListener("click", async () => {
  const url = prompt("Paste raw script URL (gist/file):");
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    // parse metadata for preview
    let meta = { name: "Imported", match: ["*"], grants: [] };
    try { if (typeof WASMonkeyMetadata !== "undefined") meta = WASMonkeyMetadata.parseMetadata(text); } catch (e) {}
    if (!confirm("Import script '" + meta.name + "' with matches: " + meta.match.join(", ") + "?")) return;
    getScripts((scripts) => {
      scripts.push({
        id: "wm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,6),
        name: meta.name,
        match: meta.match,
        exclude: meta.exclude,
        code: text,
        enabled: true,
        grants: meta.grants,
        runAt: meta.runAt || "document-start",
        version: meta.version,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setScripts(scripts, renderList);
    });
  } catch (e) {
    alert("Import failed: " + e.message);
  }
});

$("export-scripts").addEventListener("click", () => {
  getScripts((scripts) => {
    const blob = new Blob([JSON.stringify(scripts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "WASMonkey-scripts.json"; a.click();
    URL.revokeObjectURL(url);
  });
});

// Settings
function loadSettings() {
  if (!storage()) return;
  storage().get({ WASMonkeyEnabled: true, logVerbosity: "normal", recordMode: false, cspRelaxation: false }, (res) => {
    $("global-enabled").checked = res.WASMonkeyEnabled !== false;
    $("log-verbosity").value = res.logVerbosity || "normal";
    $("record-mode").checked = res.recordMode === true;
    $("csp-relax").checked = res.cspRelaxation === true;
  });
}
$("global-enabled").addEventListener("change", () => {
  if (storage()) storage().set({ WASMonkeyEnabled: $("global-enabled").checked });
});
$("log-verbosity").addEventListener("change", () => {
  if (storage()) storage().set({ logVerbosity: $("log-verbosity").value });
});
$("record-mode").addEventListener("change", () => {
  if (storage()) storage().set({ recordMode: $("record-mode").checked });
});
$("csp-relax").addEventListener("change", () => {
  if (storage()) storage().set({ cspRelaxation: $("csp-relax").checked });
});
$("clear-cache").addEventListener("click", async () => {
  try {
    const dbs = await indexedDB.databases();
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
    alert("Cache cleared");
  } catch (e) { alert("Failed: " + e.message); }
});
$("clear-storage").addEventListener("click", () => {
  if (confirm("Delete all scripts?")) {
    setScripts([], renderList);
  }
});

// Init editor
editor = new EditorView({
  doc: DEFAULT_CODE,
  extensions: [basicSetup, javascript(), EditorView.updateListener.of((update) => { if (update.docChanged) updateChecksum(); })],
  parent: $("editor"),
});
updateChecksum();

// Phase 8: WASM -> WAT viewer
let wabtModulePromise = null;
function loadWabtInOptions() {
  if (wabtModulePromise) return wabtModulePromise;
  wabtModulePromise = new Promise((resolve) => {
    const url = chrome.runtime.getURL("vendor/wabt/index.js");
    if (typeof WabtModule === "function") { WabtModule().then(resolve).catch(() => resolve(null)); return; }
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => { if (typeof WabtModule === "function") WabtModule().then(resolve).catch(() => resolve(null)); else resolve(null); };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return wabtModulePromise;
}

$("viewer-disasm").addEventListener("click", async () => {
  const wabt = await loadWabtInOptions();
  const out = $("viewer-out");
  if (!wabt) { out.textContent = "Failed to load wabt."; return; }
  const file = $("viewer-file").files[0];
  if (!file) { out.textContent = "Choose a .wasm file first."; return; }
  const buf = await file.arrayBuffer();
  try {
    const mod = wabt.readWasm(new Uint8Array(buf), { readDebugNames: true });
    const wat = mod.toText({ foldExprs: false });
    out.textContent = wat;
    out.dataset.wat = wat;
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});

$("viewer-search").addEventListener("input", () => {
  const out = $("viewer-out");
  const q = $("viewer-search").value.toLowerCase();
  if (!out.dataset.wat) return;
  if (!q) { out.textContent = out.dataset.wat; return; }
  out.textContent = out.dataset.wat.split("\\n").filter(l => l.toLowerCase().includes(q)).join("\\n");
});

// Phase 8: diff view
function simpleDiff(a, b) {
  const la = a.split("\\n"), lb = b.split("\\n");
  const out = [];
  let i = 0, j = 0;
  while (i < la.length || j < lb.length) {
    if (i < la.length && j < lb.length && la[i] === lb[j]) { out.push("  " + la[i]); i++; j++; }
    else if (j < lb.length && (i >= la.length || la.indexOf(lb[j], i) < 0)) { out.push("+ " + lb[j]); j++; }
    else if (i < la.length) { out.push("- " + la[i]); i++; }
    else { out.push("+ " + lb[j]); j++; }
  }
  return out.join("\\n");
}
$("diff-run").addEventListener("click", () => {
  const a = $("diff-a").value, b = $("diff-b").value;
  $("diff-out").textContent = simpleDiff(a, b);
});

loadSettings();
renderList();
showView("scripts");
