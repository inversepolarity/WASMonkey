/**
 * spike.mjs — Binaryen.js / wabt.js browser-build spike under real CSPs.
 *
 * Completes the Phase 0 §5 open item: the vendored *browser* builds
 * (vendor/binaryen/index.js ESM, vendor/wabt/index.js UMD — provisioned by
 * vendor.mjs, checksum-pinned in vendor.lock.json) are loaded into the MAIN
 * world of live pages under each CSP profile, and each toolkit runs a real
 * parse → emit → instantiate roundtrip. The hook's lazy-load contract
 * (window.__WASMonkey.getBinaryen()/getWabt(), docs §7.6) is exercised too.
 *
 * Usage: node spike.mjs [--mode auto|extension|cdp-inject] [--only p1,p2]
 *                       [--out test/results/toolkit-spike.json]
 */
import fs from "node:fs";
import path from "node:path";
import { PROFILE_NAMES, SITE_PROFILES, createServer, REPO_ROOT } from "./serve.mjs";
import {
  launchForTest, instrumentPage, injectHook, driveViaCdp,
  consoleParity, hookSha256,
} from "./cdputil.mjs";
import { vendorReady } from "./vendor.mjs";

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const MODE = argVal("mode", "auto");
const ONLY = argVal("only", "") ? argVal("only", "").split(",").map((s) => s.trim()) : null;
const OUT_JSON = path.resolve(REPO_ROOT, argVal("out", "test/results/toolkit-spike.json"));
const OUT_MD = OUT_JSON.replace(/\.json$/, ".md");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!vendorReady()) {
  console.error("[spike] vendor/ missing or lock mismatch — run: node tools/phase0/vendor.mjs");
  process.exit(1);
}

const { browser, mode, version, note } = await launchForTest({ mode: MODE });
console.log(`[spike] browser: ${version} | mode: ${mode}`);

const srv = createServer({ quiet: true });
const base = await srv.listen(0);

const profiles = ONLY || PROFILE_NAMES;
const results = [];

for (const profile of profiles) {
  process.stdout.write(`[spike] ${profile} … `);
  const page = await browser.newPage();
  const cap = await instrumentPage(page);
  srv.drain();
  if (mode === "cdp-inject") await injectHook(page);

  let payload = null;
  try {
    await page.goto(base + "/spike/" + profile, { waitUntil: "domcontentloaded", timeout: 20000 });
    payload = await srv
      .waitFor((p) => (p.stage === "spike-done" || p.stage === "error" || p.stage === "timeout") && (p.profile === profile || p.profile === undefined), 45000)
      .catch(() => null);
    if (!payload || payload.stage === "timeout") {
      const driven = await driveViaCdp(page, "test/spike.js", profile);
      payload = { stage: "cdp-fallback", ...driven };
    }
  } catch (e) {
    payload = { stage: "runner-error", error: String(e.message || e) };
  }
  await sleep(500);

  const steps = payload.steps || [];
  const stepOk = Object.fromEntries(steps.map((s) => [s.step, s.ok]));
  const wmLines = cap.WASMonkeyLines();
  const rec = {
    profile,
    kind: SITE_PROFILES[profile]?.kind || "local",
    label: SITE_PROFILES[profile]?.label || profile,
    csp: (() => {
      const c = SITE_PROFILES[profile]?.csp;
      if (c == null) return null;
      return typeof c === "function" ? c("<per-response-nonce>") : c;
    })(),
    stage: payload.stage,
    hookInstalled: !!payload.hookInstalled,
    steps,
    stepOk,
    WASMonkeyConsoleLines: wmLines.length,
    consoleParity: consoleParity(payload.logs, wmLines),
    cspViolations: cap.security.slice(0, 12),
    pageErrors: cap.pageErrors.slice(0, 8),
  };
  results.push(rec);
  const okCount = steps.filter((s) => s.ok).length;
  console.log(`stage=${rec.stage} steps ${okCount}/${steps.length} hook=${rec.hookInstalled} violations=${rec.cspViolations.length}`);

  await cap.detach();
  await page.close().catch(() => {});
}

await browser.close().catch(() => {});
await srv.close();

/* ------------------------- reporting -------------------------------- */

const ALL_STEPS = [
  "wabtScriptLoad", "wabtScriptLoadWithNonce", "wabtInit", "wabtParseWat", "wabtOutputInstantiate",
  "binaryenImport", "binaryenParseText", "binaryenOutputInstantiate",
  "hookApiGetWabt", "hookApiGetBinaryen",
];

const summary = {
  runAt: new Date().toISOString(),
  tool: "tools/phase0/spike.mjs",
  browser: { version, mode, note },
  hook: { path: "src/page-hook.js", sha256: hookSha256() },
  counts: {
    profilesRun: results.length,
    hookInstalled: results.filter((r) => r.hookInstalled).length,
    wabtFullRoundtripOk: results.filter((r) => r.stepOk.wabtScriptLoad || r.stepOk.wabtScriptLoadWithNonce ? r.stepOk.wabtOutputInstantiate : false).length,
    binaryenFullRoundtripOk: results.filter((r) => r.stepOk.binaryenOutputInstantiate === true).length,
    consoleParityOk: results.filter((r) => r.consoleParity?.ok).length,
  },
};

const out = { summary, results };
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");

const md = [];
md.push("# Phase 0 follow-up — Binaryen/wabt browser-build spike (per CSP profile)");
md.push("");
md.push(`- Run at: ${summary.runAt}`);
md.push(`- Browser: ${version} — mode: \`${mode}\``);
md.push("- Vendored builds: `vendor/binaryen/index.js` (binaryen@132.0.0 ESM, embedded wasm), `vendor/wabt/index.js` (wabt@1.0.39 UMD, embedded wasm) — pinned by `tools/phase0/vendor.lock.json`");
md.push("");
md.push("| Profile | Kind | Hook | wabt load | wabt init+parse+instantiate | Binaryen import | Binaryen parse+instantiate | hook getWabt() | hook getBinaryen() | CSP violations |");
md.push("|---------|------|------|-----------|------------------------------|-----------------|----------------------------|----------------|--------------------|----------------|");
for (const r of results) {
  const load = r.stepOk.wabtScriptLoad ? "plain ✅" : r.stepOk.wabtScriptLoadWithNonce ? "nonce ✅" : "⛔";
  const wabtRt = r.stepOk.wabtInit && r.stepOk.wabtParseWat && r.stepOk.wabtOutputInstantiate ? "✅" : r.stepOk.wabtInit ? "partial ⚠️" : "⛔";
  const byRt = r.stepOk.binaryenImport && r.stepOk.binaryenParseText && r.stepOk.binaryenOutputInstantiate ? "✅" : r.stepOk.binaryenImport ? "partial ⚠️" : "⛔";
  md.push(
    `| ${r.profile} | ${r.kind} | ${r.hookInstalled ? "✅" : "❌"} | ${load} | ${wabtRt} | ${r.stepOk.binaryenImport ? "✅" : "⛔"} | ${byRt} | ${r.stepOk.hookApiGetWabt ? "✅" : "⛔"} | ${r.stepOk.hookApiGetBinaryen ? "✅" : "⛔"} | ${r.cspViolations.length} |`
  );
}
md.push("");
md.push(`Counts: ${JSON.stringify(summary.counts)}`);
md.push("");
md.push("Step-level error details are in `toolkit-spike.json` (`results[].steps[].error`).");
md.push("");
fs.writeFileSync(OUT_MD, md.join("\n"));

console.log(`\n[spike] wrote ${OUT_JSON}`);
console.log(`[spike] wrote ${OUT_MD}`);
console.log("[spike] summary:", JSON.stringify(summary.counts));
