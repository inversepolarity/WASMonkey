import puppeteer from "puppeteer-core";
const chrome = "/home/suraj/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const repo = "/home/suraj/evenzero/_lab/wasMonkey";
const userDataDir = "/tmp/opencode/chrome-profile-seed";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  userDataDir,
  env: { ...process.env, LD_LIBRARY_PATH: "/nix/store/hfyx5k95bcl2iv8ik3ay9s0zp828k3gb-playwright-fhs-fhsenv-rootfs/usr/lib64" },
  args: ["--no-sandbox","--disable-dev-shm-usage","--disable-gpu",`--disable-extensions-except=${repo}`,`--load-extension=${repo}`],
});
// Wait for service worker
await new Promise(r=>setTimeout(r,3000));
const targets = browser.targets();
console.log("targets:", targets.map(t=>t.type()+":"+t.url()).join(" | "));
const sw = targets.find(t => t.type() === "service_worker" || t.url().includes("service-worker") || t.url().includes("background"));
console.log("sw target:", sw && sw.url());
if (sw) {
  const session = await sw.createCDPSession();
  await session.send("Runtime.enable");
  const { result } = await session.send("Runtime.evaluate", {
    expression: `(async () => {
      const script = { id:"test1", name:"Logger", match:["*"], exclude:[], code: "// ==WasMonkeyScript==\\n// @name Logger\\n// @match *\\n// @grant patchBytes\\n// ==/WasMonkeyScript==\\nwasMonkey.onBeforeInstantiate((b,c)=>{wasMonkey.log('intercepted',b.byteLength,'bytes');return b;});", enabled:true, grants:["patchBytes"], runAt:"document-start", createdAt:Date.now(), updatedAt:Date.now() };
      await new Promise((res,rej)=>chrome.storage.local.set({scripts:[script]}, ()=>chrome.runtime.lastError?rej(chrome.runtime.lastError):res()));
      return "seeded";
    })()`,
    awaitPromise: true,
  });
  console.log("seed result:", result.value || result.description);
}
// Now open a page
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));
await page.goto("https://surajsharma.github.io/wasm-game-of-life/", { waitUntil: "networkidle2", timeout: 60000 }).catch(e=>console.log("nav:",e.message));
await new Promise(r=>setTimeout(r,6000));
console.log("=== console logs ===");
logs.filter(l=>/WASMonkey|wasMonkey/i.test(l)).forEach(l=>console.log(l));
const info = await page.evaluate(() => ({ scripts: window.__WASMonkeyScripts, mods: (window.__WASMonkeyModules||[]).length }));
console.log("INFO:", JSON.stringify(info));
await browser.close();
process.exit(0);
