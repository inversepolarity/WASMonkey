import { createServer } from "./serve.mjs";
import { launchForTest, instrumentPage, injectHook } from "./cdputil.mjs";

const { browser } = await launchForTest({ mode: "cdp-inject" });
const srv = createServer({ quiet: true });
const base = await srv.listen(0);
const page = await browser.newPage();
const cap = await instrumentPage(page);
await injectHook(page);
await page.goto(base + "/test/harness.html", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 500));

// Fuzz: feed malformed bytes via CDP evaluate
const results = await page.evaluate(async () => {
  const out = { crashes: 0, errors: 0, ok: 0 };
  function rnd(n) { const a = new Uint8Array(n); for (let i=0;i<n;i++) a[i]=Math.random()*256|0; return a; }
  for (let i=0;i<50;i++) {
    const bytes = rnd(Math.random()*64|0);
    for (const fn of [WebAssembly.compile, (b)=>WebAssembly.instantiate(b,{})]) {
      try { await fn(bytes); out.ok++; } catch (e) { out.errors++; }
    }
    // truncated valid header
    try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0])); out.ok++; } catch(e){ out.errors++; }
  }
  return out;
});
console.log("fuzz results:", JSON.stringify(results));
console.log("page errors:", cap.pageErrors.length);

await cap.detach();
await page.close();
await browser.close();
await srv.close();
process.exit(cap.pageErrors.length === 0 ? 0 : 1);
