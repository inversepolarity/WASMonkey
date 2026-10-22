/**
 * cdputil.mjs — shared browser-launch + console-capture helpers for the
 * Phase 0 follow-up runners (matrix.mjs, spike.mjs).
 *
 * Two run modes:
 *  - "extension":  the repo is loaded as a real unpacked MV3 extension
 *                  (--load-extension). Highest fidelity: exercises manifest
 *                  parsing and the `world: "MAIN"` content-script injection
 *                  path itself. Requires an extension-capable Chromium/Chrome
 *                  build (the sandbox's headless_shell build has the
 *                  extensions subsystem compiled out; full Chrome/Chromium on
 *                  a normal machine works).
 *  - "cdp-inject": src/page-hook.js is injected into the page's MAIN world at
 *                  document_start via Page.addScriptToEvaluateOnNewDocument —
 *                  the same renderer mechanism Chromium uses to run
 *                  `world: "MAIN"` content scripts, minus the extension
 *                  plumbing. Works on every CDP-capable Chromium, including
 *                  headless_shell.
 *
 * Console capture (limitation #4 of the original Phase 0 run): we listen to
 * Runtime.consoleAPICalled (via puppeteer's console event), Runtime exceptions
 * (pageerror), and Log.entryAdded (structured CSP/security violation reports)
 * over CDP. Every captured line is later cross-checked against the page's own
 * /collect report of window.__WASMonkeyLogs — the two channels must agree.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import puppeteer from "puppeteer-core";
import { resolveBrowser, launchArgs } from "./browser.mjs";
import { createServer } from "./serve.mjs";

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const HOOK_PATH = path.join(REPO_ROOT, "src", "page-hook.js");

export function hookSource() {
  return fs.readFileSync(HOOK_PATH, "utf8");
}

export function hookSha256() {
  return crypto.createHash("sha256").update(fs.readFileSync(HOOK_PATH)).digest("hex");
}

/**
 * Launch the provisioned browser. In "auto"/"extension" mode we launch with
 * --load-extension and then probe whether the hook actually arrives via the
 * manifest; if not, we relaunch plain and use cdp-inject.
 */
export async function launchForTest({ mode = "auto", quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log("[cdputil]", ...a);
  const { executablePath, env, version } = await resolveBrowser({ quiet });

  const tryLaunch = async (withExtension) =>
    puppeteer.launch({
      executablePath,
      env,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        ...(withExtension ? launchArgs({ repoRoot: REPO_ROOT }).filter((a) => a.startsWith("--disable-extensions-except") || a.startsWith("--load-extension")) : []),
      ],
    });

  if (mode === "cdp-inject") {
    return { browser: await tryLaunch(false), mode: "cdp-inject", version, note: "mode forced via --mode" };
  }

  // Probe extension support on a permissive fixture (no CSP).
  const srv = createServer({ quiet: true });
  const base = await srv.listen(0);
  let browser = await tryLaunch(true);
  let extensionWorks = false;
  try {
    const page = await browser.newPage();
    srv.drain();
    await page.goto(base + "/site/crazygames", { waitUntil: "domcontentloaded", timeout: 20000 });
    const done = await srv
      .waitFor((p) => p.stage === "done" || p.stage === "error" || p.stage === "timeout", 15000)
      .catch(() => null);
    extensionWorks = !!(done && done.hookInstalled);
    await page.close();
  } catch (e) {
    log("extension probe failed:", e.message);
  } finally {
    await srv.close();
  }

  if (extensionWorks) {
    await browser.close().catch(() => {});
    // relaunch cleanly for the real run
    browser = await tryLaunch(true);
    return {
      browser,
      mode: "extension",
      version,
      note: "unpacked MV3 extension loaded via --load-extension; MAIN-world content script active",
    };
  }

  await browser.close().catch(() => {});
  browser = await tryLaunch(false);
  return {
    browser,
    mode: "cdp-inject",
    version,
    note:
      "browser build has no extensions subsystem (chrome-headless_shell); " +
      "src/page-hook.js injected into MAIN world at document_start via " +
      "Page.addScriptToEvaluateOnNewDocument (the same renderer mechanism " +
      "used for world:MAIN content scripts). Re-run with --mode extension " +
      "against full Chrome/Chromium to exercise manifest plumbing.",
  };
}

/** Attach console/security capture to a page. Returns collectors. */
export async function instrumentPage(page) {
  const cap = { console: [], security: [], pageErrors: [] };
  page.on("console", (msg) => {
    cap.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    cap.pageErrors.push(String(err && err.message ? err.message : err));
  });
  const client = await page.createCDPSession();
  await client.send("Log.enable");
  client.on("Log.entryAdded", (e) => {
    const entry = e.entry;
    if (entry.source === "security" || /Content Security Policy|Refused/i.test(entry.text || "")) {
      cap.security.push({ level: entry.level, source: entry.source, text: entry.text, url: entry.url || null });
    }
  });
  cap.client = client;
  cap.WASMonkeyLines = () => cap.console.filter((m) => m.text.includes("[WASMonkey]")).map((m) => m.text);
  cap.detach = async () => { await client.detach().catch(() => {}); };
  return cap;
}

/**
 * Inject the hook into the MAIN world at document_start (cdp-inject mode).
 * Must be called BEFORE navigation.
 */
export async function injectHook(page) {
  await page.evaluateOnNewDocument(hookSource());
}

/**
 * Fallback for profiles whose CSP blocks the fixture <script> entirely:
 * drive the fixture function through CDP evaluate (not subject to page CSP,
 * exactly like content scripts).
 */
export async function driveViaCdp(page, fixtureFile, profile) {
  const src = fs.readFileSync(path.join(REPO_ROOT, fixtureFile), "utf8");
  await page.evaluate("globalThis.__wmCdpDriven = true;");
  await page.evaluate(src);
  const fn = fixtureFile.endsWith("spike.js") ? "__wmSpike" : "__wmBattery";
  return page.evaluate(
    `(async () => await window.${fn}(${JSON.stringify(profile)}))()`
  );
}

/**
 * Cross-check: every hook log line the page reported through /collect must
 * also have been captured through the CDP console channel (limitation #4).
 */
export function consoleParity(collectLogs, capturedLines) {
  const matched = [];
  const missed = [];
  for (const line of collectLogs || []) {
    if (capturedLines.some((t) => t.includes(line))) matched.push(line);
    else missed.push(line);
  }
  return { collectLogs: (collectLogs || []).length, matchedInConsole: matched.length, missed, ok: missed.length === 0 };
}
