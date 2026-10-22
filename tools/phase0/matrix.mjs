/**
 * matrix.mjs — automated WASM interception matrix runner.
 *
 * Runs the wasMonkey hook against every CSP fixture profile (surveyed-site
 * replicas + generic policy classes, see serve.mjs) plus the original local
 * harness, captures MAIN-world console output over CDP, cross-checks it
 * against the page's own /collect report, and records per-entry-point results
 * (including patched-byte re-instantiation under each CSP).
 *
 * Usage:
 *   node matrix.mjs [--mode auto|extension|cdp-inject] [--only p1,p2]
 *                   [--url-list urls.txt] [--out test/results/interception-matrix.json]
 *
 *   --url-list: one "name url" (or bare url) per line. Runs the same capture
 *               against live sites — this is the Phase 10 real-site matrix
 *               entry point (from this sandbox, external egress is limited to
 *               the toolchain registries, so live runs only work on machines
 *               with normal network access; failures are recorded as such).
 *
 * Outputs JSON + Markdown reports under test/results/.
 */
import fs from "node:fs";
import path from "node:path";
import { PROFILE_NAMES, SITE_PROFILES, createServer, REPO_ROOT } from "./serve.mjs";
import {
  launchForTest, instrumentPage, injectHook, driveViaCdp,
  consoleParity, hookSha256,
} from "./cdputil.mjs";

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const MODE = argVal("mode", "auto");
const ONLY = argVal("only", "") ? argVal("only", "").split(",").map((s) => s.trim()) : null;
const URL_LIST = argVal("url-list", null);
const OUT_JSON = path.resolve(REPO_ROOT, argVal("out", "test/results/interception-matrix.json"));
const OUT_MD = OUT_JSON.replace(/\.json$/, ".md");

const KIND_RE = /\[wasMonkey\] (compile|instantiateStreaming|instantiate|compileStreaming|Module ctor): (\d+) bytes/;
const EXPECTED_KINDS = ["compile", "instantiate", "instantiateStreaming", "compileStreaming", "Module ctor"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kindsFromLines(lines) {
  const kinds = new Map();
  for (const l of lines) {
    const m = KIND_RE.exec(l);
    if (m) kinds.set(m[1], (kinds.get(m[1]) || 0) + 1);
  }
  return kinds;
}

async function runFixture({ browser, srv, base, mode, url, profile, waitStage }) {
  const page = await browser.newPage();
  const cap = await instrumentPage(page);
  srv.drain();
  if (mode === "cdp-inject") await injectHook(page);

  const rec = {
    profile,
    kind: SITE_PROFILES[profile]?.kind || "local",
    label: SITE_PROFILES[profile]?.label || profile,
    csp: (() => {
      const c = SITE_PROFILES[profile]?.csp;
      if (c == null) return null;
      return typeof c === "function" ? c("<per-response-nonce>") : c;
    })(),
    note: SITE_PROFILES[profile]?.note || null,
  };

  let navError = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (e) {
    navError = String(e.message || e);
  }

  let payload = await srv
    .waitFor((p) => p.stage === waitStage && (p.profile === profile || p.profile === undefined), 12000)
    .catch(() => null);

  if (!payload || payload.stage === "timeout") {
    // CSP blocked the fixture <script> (or its /collect post): drive it via
    // CDP evaluate — not subject to page CSP, exactly like content scripts.
    try {
      const driven = await driveViaCdp(page, "test/battery.js", profile);
      payload = { stage: "cdp-fallback", ...driven };
    } catch (e) {
      payload = payload || { stage: "no-report", error: String(e.message || e) };
    }
  }
  await sleep(700); // let async hook logs (streaming clones) flush into CDP

  const wmLines = cap.wasMonkeyLines();
  const kinds = kindsFromLines(wmLines);
  const entries = payload.entries || [];
  const entryByName = Object.fromEntries(entries.map((e) => [e.entry, e]));

  Object.assign(rec, {
    stage: payload.stage,
    navError,
    hookInstalled: !!payload.hookInstalled,
    entries,
    wasmCompileAllowed: entryByName.compile ? entryByName.compile.ok : null,
    patchedReinstantiateAllowed: entryByName.patchedReinstantiate ? entryByName.patchedReinstantiate.ok : null,
    intercepted: {
      kindsSeen: [...kinds.keys()],
      kindCounts: Object.fromEntries(kinds),
      allExpectedKinds: EXPECTED_KINDS.every((k) => kinds.has(k)),
      wasMonkeyConsoleLines: wmLines.length,
    },
    consoleParity: consoleParity(payload.logs, wmLines.map((t) => t)),
    cspViolations: cap.security.slice(0, 12),
    pageErrors: cap.pageErrors.slice(0, 8),
  });

  await cap.detach();
  await page.close().catch(() => {});
  return rec;
}

async function runLiveUrl({ browser, mode, name, url }) {
  const page = await browser.newPage();
  const cap = await instrumentPage(page);
  if (mode === "cdp-inject") await injectHook(page);
  const rec = { name, url, navError: null, hookInstalled: null, wasMonkeyConsoleLines: 0, kindsSeen: [] };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(10000); // dwell: let site WASM loads fire
    const wm = cap.wasMonkeyLines();
    const kinds = kindsFromLines(wm);
    rec.hookInstalled = await page.evaluate(() => !!window.__wasMonkeyInstalled).catch(() => null);
    rec.wasMonkeyConsoleLines = wm.length;
    rec.kindsSeen = [...kinds.keys()];
    rec.title = await page.title().catch(() => null);
  } catch (e) {
    rec.navError = String(e.message || e).split("\n")[0];
  }
  await cap.detach();
  await page.close().catch(() => {});
  return rec;
}

/* ------------------------------------------------------------------ */

const { browser, mode, version, note } = await launchForTest({ mode: MODE });
console.log(`[matrix] browser: ${version} | mode: ${mode}`);
if (note) console.log(`[matrix] mode note: ${note}`);

const srv = createServer({ quiet: true });
const base = await srv.listen(0);

const profiles = (ONLY || PROFILE_NAMES).filter((p) => SITE_PROFILES[p] || ONLY == null);
const results = [];

// Original local harness first (backward compatibility with Phase 0 §2).
console.log("[matrix] running local harness (test/harness.html)…");
{
  const page = await browser.newPage();
  const cap = await instrumentPage(page);
  srv.drain();
  if (mode === "cdp-inject") await injectHook(page);
  await page.goto(base + "/test/harness.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  const payload = await srv
    .waitFor((p) => p.stage === "done" || p.stage === "error" || p.stage === "timeout", 15000)
    .catch(() => ({ stage: "no-report" }));
  await sleep(700);
  const wmLines = cap.wasMonkeyLines();
  const kinds = kindsFromLines(wmLines);
  results.push({
    profile: "local-harness",
    kind: "local",
    label: "Original Phase 0 harness (no CSP)",
    stage: payload.stage,
    hookInstalled: !!payload.hookInstalled,
    logsFromCollect: payload.logs || [],
    wasMonkeyConsoleLines: wmLines.length,
    // primary (non-stack) hook lines as captured by the CDP console channel
    wasMonkeyPrimaryLines: wmLines.filter((l) => !l.includes("[wasMonkey] stack")),
    kindsSeen: [...kinds.keys()],
    intercepted: {
      kindsSeen: [...kinds.keys()],
      kindCounts: Object.fromEntries(kinds),
      allExpectedKinds: EXPECTED_KINDS.every((k) => kinds.has(k)),
      wasMonkeyConsoleLines: wmLines.length,
    },
    consoleParity: consoleParity(payload.logs, wmLines),
    errors: payload.errors || [],
    pageErrors: cap.pageErrors,
  });
  await cap.detach();
  await page.close().catch(() => {});
  console.log(`[matrix]   stage=${results[0].stage} hook=${results[0].hookInstalled} kinds=${results[0].kindsSeen.length}/5 parity=${results[0].consoleParity.ok}`);
}

for (const profile of profiles) {
  process.stdout.write(`[matrix] ${profile} … `);
  const rec = await runFixture({
    browser, srv, base, mode,
    url: base + "/site/" + profile,
    profile,
    waitStage: "done",
  });
  results.push(rec);
  const kinds = rec.intercepted?.kindsSeen?.length ?? 0;
  console.log(
    `stage=${rec.stage} hook=${rec.hookInstalled} wasmCompile=${rec.wasmCompileAllowed} patched=${rec.patchedReinstantiateAllowed} kinds=${kinds}/5 parity=${rec.consoleParity?.ok} violations=${rec.cspViolations?.length ?? 0}`
  );
}

let realSiteAttempts = [];
if (URL_LIST) {
  const lines = fs.readFileSync(URL_LIST, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const [name, ...rest] = line.split(/\s+/);
    const url = rest.join(" ") || name;
    process.stdout.write(`[matrix] live ${name} … `);
    const rec = await runLiveUrl({ browser, mode, name: rest.length ? name : new URL(url).hostname, url });
    realSiteAttempts.push(rec);
    console.log(rec.navError ? `navError: ${rec.navError}` : `hook=${rec.hookInstalled} lines=${rec.wasMonkeyConsoleLines}`);
  }
}

await browser.close().catch(() => {});
await srv.close();

/* ------------------------- reporting -------------------------------- */

const summary = {
  runAt: new Date().toISOString(),
  tool: "tools/phase0/matrix.mjs",
  browser: { version, mode, note },
  hook: { path: "src/page-hook.js", sha256: hookSha256() },
  counts: {
    profilesRun: results.filter((r) => r.kind !== "local").length,
    hookInstalled: results.filter((r) => r.hookInstalled).length,
    allFiveKindsIntercepted: results.filter((r) => r.intercepted?.allExpectedKinds).length,
    consoleParityOk: results.filter((r) => r.consoleParity?.ok).length,
    wasmCompileAllowed: results.filter((r) => r.wasmCompileAllowed === true).length,
    wasmCompileBlocked: results.filter((r) => r.wasmCompileAllowed === false).length,
    patchedReinstantiateAllowed: results.filter((r) => r.patchedReinstantiateAllowed === true).length,
  },
};

const out = { summary, results, realSiteAttempts };
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");

// Markdown report
const md = [];
md.push("# Phase 0 follow-up — WASM interception matrix (automated, headless)");
md.push("");
md.push(`- Run at: ${summary.runAt}`);
md.push(`- Browser: ${version} — mode: \`${mode}\``);
md.push(`- Hook: \`src/page-hook.js\` (sha256 ${summary.hook.sha256.slice(0, 16)}…)`);
md.push(`- Mode note: ${note}`);
md.push("");
md.push("| # | Profile | Kind | CSP | Hook installed | Kinds intercepted (of 5) | Page WASM compile | Patched re-instantiate | Console parity (CDP vs /collect) | CSP violations |");
md.push("|---|---------|------|-----|----------------|--------------------------|-------------------|------------------------|----------------------------------|----------------|");
results.forEach((r, i) => {
  const cspShort = r.csp === null ? "none" : r.csp === undefined ? "—" : r.csp.length > 46 ? r.csp.slice(0, 43) + "…" : r.csp;
  const kinds = r.intercepted ? `${r.intercepted.kindsSeen.length}/5` : `${(r.kindsSeen || []).length}/5`;
  md.push(
    `| ${i + 1} | ${r.profile} | ${r.kind} | \`${cspShort.replace(/\|/g, "\\|")}\` | ${r.hookInstalled ? "✅" : "❌"} | ${kinds} ${r.intercepted?.allExpectedKinds ? "✅" : (r.kind === "local" ? "" : "⚠️")} | ${r.wasmCompileAllowed === true ? "✅ allowed" : r.wasmCompileAllowed === false ? "⛔ blocked" : "—"} | ${r.patchedReinstantiateAllowed === true ? "✅" : r.patchedReinstantiateAllowed === false ? "⛔" : "—"} | ${r.consoleParity ? (r.consoleParity.ok ? `✅ ${r.consoleParity.matchedInConsole}/${r.consoleParity.collectLogs}` : "❌") : "—"} | ${r.cspViolations?.length ?? r.errors?.length ?? 0} |`
  );
});
if (realSiteAttempts.length) {
  md.push("");
  md.push("## Live-site attempts (--url-list)");
  md.push("");
  md.push("| Name | URL | Result |");
  md.push("|------|-----|--------|");
  for (const r of realSiteAttempts) {
    md.push(`| ${r.name} | ${r.url} | ${r.navError ? "❌ " + r.navError : `hook=${r.hookInstalled}, ${r.wasMonkeyConsoleLines} wasMonkey lines`} |`);
  }
}
md.push("");
md.push(`Counts: ${JSON.stringify(summary.counts)}`);
md.push("");
fs.writeFileSync(OUT_MD, md.join("\n"));

console.log(`\n[matrix] wrote ${OUT_JSON}`);
console.log(`[matrix] wrote ${OUT_MD}`);
console.log("[matrix] summary:", JSON.stringify(summary.counts));
