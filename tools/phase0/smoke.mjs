/**
 * smoke.mjs — one-shot sanity check on the original Phase 0 harness page:
 * launches the browser (extension mode when available, CDP MAIN-world
 * injection otherwise), verifies the hook intercepts all six entry points,
 * and cross-checks CDP console capture against the /collect report.
 */
import { createServer } from "./serve.mjs";
import { launchForTest, instrumentPage, injectHook, consoleParity } from "./cdputil.mjs";

const { browser, mode, version } = await launchForTest({ mode: "auto" });
console.log(`[smoke] ${version} | mode: ${mode}`);

const srv = createServer({ quiet: true });
const base = await srv.listen(0);

const page = await browser.newPage();
const cap = await instrumentPage(page);
if (mode === "cdp-inject") await injectHook(page);

await page.goto(base + "/test/harness.html", { waitUntil: "domcontentloaded" });
const done = await srv
  .waitFor((p) => p.stage === "done" || p.stage === "error" || p.stage === "timeout", 20000)
  .catch(() => ({ stage: "no-report" }));
await new Promise((r) => setTimeout(r, 700));

const wmLines = cap.wasMonkeyLines();
const parity = consoleParity(done.logs, wmLines);
console.log("[smoke] stage:", done.stage, "| hookInstalled:", done.hookInstalled);
console.log("[smoke] collect logs:", JSON.stringify(done.logs, null, 0));
console.log(`[smoke] CDP console: ${wmLines.length} [wasMonkey] lines`);
console.log("[smoke] parity:", JSON.stringify(parity));
console.log("[smoke] page errors:", JSON.stringify(done.errors || [], null, 0), JSON.stringify(cap.pageErrors));

const kinds = ["compile:", "instantiate:", "instantiateStreaming:", "compileStreaming:", "Module ctor:"];
const kindsSeen = kinds.filter((k) => wmLines.some((l) => l.includes("[wasMonkey] " + k)));
const ok = done.stage === "done" && done.hookInstalled && kindsSeen.length === 5 && parity.ok;
console.log(ok ? `[smoke] PASS (${kindsSeen.length}/5 entry kinds intercepted, console parity OK)` : `[smoke] FAIL (${kindsSeen.length}/5)`);

await cap.detach();
await browser.close().catch(() => {});
await srv.close();
process.exitCode = ok ? 0 : 1;
