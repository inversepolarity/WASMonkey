async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url;
  // Detected modules via MAIN-world global
  let mods = [];
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => (window.__WASMonkeyModules || []).map(m => ({ byteLength: m.byteLength, url: m.url })),
    });
    mods = (res && res[0] && res[0].result) || [];
  } catch (e) { mods = []; }
  const modEl = document.getElementById("modules");
  if (mods.length === 0) modEl.textContent = "No WASM modules detected yet.";
  else modEl.innerHTML = "<b>Modules detected:</b> " + mods.length + "<br>" + mods.map((m, i) => `<div class="item">${m.byteLength} bytes${m.memorySize ? " | mem " + m.memorySize : ""}${m.tableSize ? " | table " + m.tableSize : ""}<br><small>${m.exports ? m.exports.join(", ") : ""}</small><br><button data-dump="${i}">Dump exports</button></div>`).join("");
  modEl.querySelectorAll("button[data-dump]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.dump, 10);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (i) => { const m = (window.__WASMonkeyModules || [])[i]; console.log("[WASMonkey] module", i, m); },
        args: [idx],
      });
    });
  });

  // Errors surfaced from page
  let errs = [];
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => (window.__WASMonkeyErrors || []).slice(-5),
    });
    errs = (res && res[0] && res[0].result) || [];
  } catch (e) { errs = []; }
  if (errs.length) {
    const errDiv = document.createElement("div");
    errDiv.style.color = "#f66";
    errDiv.style.fontSize = ".75rem";
    errDiv.innerHTML = "<b>Errors:</b><br>" + errs.map(e => escape(e.message)).join("<br>");
    document.body.insertBefore(errDiv, document.getElementById("scripts"));
  }

  // Active scripts
  const scriptsEl = document.getElementById("scripts");
  try {
    const scripts = await new Promise((resolve) => {
      chrome.storage.local.get({ scripts: [] }, (r) => resolve((r && r.scripts) || []));
    });
    const matching = scripts.filter(s => s.enabled !== false);
    scriptsEl.innerHTML = "<b>Scripts:</b> " + matching.length + " enabled" +
      matching.map(s => `<div class="item">${escape(s.name)} — ${(s.match||[]).join(", ")}</div>`).join("");
  } catch (e) { scriptsEl.textContent = "Scripts unavailable."; }

  document.getElementById("open-dashboard").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("disable-site").addEventListener("click", async () => {
    if (!url) return;
    const host = new URL(url).hostname;
    chrome.storage.local.get({ disabledSites: [] }, (res) => {
      const list = res.disabledSites || [];
      if (!list.includes(host)) list.push(host);
      chrome.storage.local.set({ disabledSites: list }, () => {
        chrome.tabs.reload(tab.id);
      });
    });
  });
}
function escape(s) { return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
main();
