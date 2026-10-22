import puppeteer from "puppeteer-core";
const chrome = "/home/suraj/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  env: { ...process.env, LD_LIBRARY_PATH: "/nix/store/hfyx5k95bcl2iv8ik3ay9s0zp828k3gb-playwright-fhs-fhsenv-rootfs/usr/lib64" },
  args: ["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"],
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));
await page.goto("https://surajsharma.github.io/wasm-game-of-life/", { waitUntil: "networkidle2", timeout: 60000 }).catch(e=>console.log("nav:",e.message));
const res = await page.evaluate(() => {
  try { const f = new Function("return 42"); return "new Function OK: " + f(); }
  catch (e) { return "new Function BLOCKED: " + e.message; }
});
console.log("RESULT:", res);
await new Promise(r=>setTimeout(r,2000));
logs.forEach(l=>console.log(l));
await browser.close();
process.exit(0);
