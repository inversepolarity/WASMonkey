/**
 * serve.mjs — local fixture server for the WASMonkey Phase 0 follow-up run.
 *
 * Responsibilities:
 *  - Static file serving of the repo root (harness, battery/spike scripts,
 *    vendored toolkit builds under /vendor/, test/sample.wasm).
 *  - POST /collect endpoint: receives JSON payloads from fixture pages
 *    (same contract as test/harness.html already uses). Payloads are stored
 *    in memory and can be awaited per-run.
 *  - Dynamic CSP fixture pages:
 *      /site/<profile>   — interception battery (test/battery.js)
 *      /spike/<profile>  — Binaryen/wabt toolkit spike (test/spike.js)
 *    Each profile replicates the Content-Security-Policy header observed for
 *    a surveyed site (docs/feasibility.md §4) or a generic CSP class, so the
 *    matrix can run without external network egress. Fixture logic lives in
 *    external same-origin scripts (never inline) and carries the per-response
 *    CSP nonce when the profile is nonce-based.
 *
 * Used by tools/phase0/matrix.mjs and tools/phase0/spike.mjs.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

/* ------------------------------------------------------------------ */
/* CSP profiles                                                        */
/* ------------------------------------------------------------------ */

/**
 * Site profiles derived from docs/feasibility.md §4 (header survey of the
 * original Phase 0 run). `csp` replicates the observed directives as closely
 * as a local fixture allows; `kind` marks whether the profile is a
 * surveyed-site replica ("site") or a generic policy class ("class").
 * Nonce-based profiles receive a fresh nonce per response.
 */
export const SITE_PROFILES = {
  // --- surveyed-site replicas (docs/feasibility.md §4) ---
  figma: {
    kind: "site",
    label: "Figma (replica)",
    csp:
      "default-src * blob: data: filesystem:; " +
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: blob: data:; " +
      "worker-src 'self' blob:; connect-src *; img-src * data: blob:; " +
      "style-src * 'unsafe-inline'",
    note: "unsafe-eval present, no explicit wasm-unsafe-eval; worker-src 'self'",
  },
  "google-earth": {
    kind: "site",
    label: "Google Earth (replica)",
    csp: (nonce) =>
      `script-src 'nonce-${nonce}' 'unsafe-inline'; worker-src 'self'; ` +
      "object-src 'none'; base-uri 'self'",
    note: "nonce-based script-src, unsafe-inline, worker-src 'self', no eval sources",
  },
  mdn: {
    kind: "site",
    label: "MDN (replica)",
    csp:
      "default-src https:; script-src 'self' 'wasm-unsafe-eval' https://*.mdnplay.dev; " +
      "img-src * data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:",
    note: "explicitly includes 'wasm-unsafe-eval' — the WASM-friendly reference",
  },
  discord: {
    kind: "site",
    label: "Discord (replica)",
    csp:
      "default-src 'self'; script-src 'self' 'sha256-aaaa' 'sha256-bbbb' https://cdn.discordapp.com; " +
      "style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; img-src * data:; worker-src 'self' blob:",
    note: "large allowlist + hashes, no unsafe-eval / wasm-unsafe-eval",
  },
  "google-meet": {
    kind: "site",
    label: "Google Meet (replica)",
    csp:
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https:; " +
      "worker-src 'self' blob:; connect-src 'self' https: wss: data: blob:; img-src * data: blob:",
    note: "'unsafe-eval' present — should allow WASM compilation",
  },
  crazygames: {
    kind: "site",
    label: "CrazyGames (replica)",
    csp: null,
    note: "no CSP header observed — permissive, lowest risk",
  },

  // --- generic policy classes (round out the 12-profile matrix) ---
  "strict-no-eval": {
    kind: "class",
    label: "strict: default-src 'self' (no eval sources)",
    csp: "default-src 'self'; object-src 'none'",
    note: "blocks eval AND wasm compilation of any bytecode (no unsafe-eval/wasm-unsafe-eval)",
  },
  "wasm-unsafe-eval-only": {
    kind: "class",
    label: "script-src 'self' 'wasm-unsafe-eval'",
    csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'",
    note: "wasm-unsafe-eval allows WebAssembly compilation but not eval()/new Function",
  },
  "unsafe-eval-only": {
    kind: "class",
    label: "script-src 'self' 'unsafe-eval'",
    csp: "default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'none'",
    note: "legacy path: unsafe-eval also permits wasm compilation in all current engines",
  },
  "nonce-only": {
    kind: "class",
    label: "script-src 'nonce-...' (strict, no inline/eval)",
    csp: (nonce) =>
      `default-src 'self'; script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'`,
    note: "nonce-only: non-nonce scripts and eval/wasm all blocked",
  },
  "default-src-none": {
    kind: "class",
    label: "default-src 'none'",
    csp: "default-src 'none'",
    note: "most restrictive realistic policy — blocks scripts, fetch and wasm alike",
  },
  "self-plus-cdn": {
    kind: "class",
    label: "script-src 'self' https://cdn.example (typical SaaS)",
    csp:
      "default-src 'self'; script-src 'self' https://cdn.example; " +
      "connect-src 'self' https:; img-src 'self' data:; worker-src 'self' blob:",
    note: "common SaaS policy: self + one CDN, no eval sources",
  },
};

export const PROFILE_NAMES = Object.keys(SITE_PROFILES);

/* ------------------------------------------------------------------ */
/* Fixture pages                                                       */
/* ------------------------------------------------------------------ */

function fixturePage({ title, profileName, nonce, scriptSrc }) {
  // No inline script anywhere: the fixture logic is an external same-origin
  // script, stamped with the response nonce when the profile requires one.
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="wm-nonce" content="${nonce}">
<title>${title}</title>
</head>
<body>
<h1>${title}</h1>
<script src="${scriptSrc}?profile=${encodeURIComponent(profileName)}" nonce="${nonce}"></script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".md": "text/markdown",
};

export function createServer({ quiet = false } = {}) {
  /** collected payloads, in arrival order: { at, payload } */
  const collected = [];
  const listeners = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    // --- collect endpoint -------------------------------------------------
    if (url.pathname === "/collect" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let payload;
        try { payload = JSON.parse(body); } catch { payload = { stage: "badjson", raw: body.slice(0, 500) }; }
        const entry = { at: Date.now(), payload };
        collected.push(entry);
        for (const fn of listeners) { try { fn(entry); } catch {} }
        res.writeHead(204).end();
      });
      return;
    }

    // --- CSP fixture pages -------------------------------------------------
    const fixtureRoutes = { "/site/": "site", "/spike/": "spike" };
    for (const [prefix, kind] of Object.entries(fixtureRoutes)) {
      if (url.pathname.startsWith(prefix)) {
        const name = url.pathname.slice(prefix.length).replace(/\/$/, "");
        const profile = SITE_PROFILES[name];
        if (!profile) { res.writeHead(404).end("unknown profile"); return; }
        const nonce = "n-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const headers = { "Content-Type": "text/html; charset=utf-8", "X-Fixture-Nonce": nonce };
        const csp = typeof profile.csp === "function" ? profile.csp(nonce) : profile.csp;
        if (csp) headers["Content-Security-Policy"] = csp;
        const page = fixturePage({
          title: kind === "site" ? `WASMonkey battery — ${name}` : `WASMonkey toolkit spike — ${name}`,
          profileName: name,
          nonce,
          scriptSrc: kind === "site" ? "/test/battery.js" : "/test/spike.js",
        });
        res.writeHead(200, headers);
        res.end(page);
        return;
      }
    }

    // --- static repo files -------------------------------------------------
    let rel = decodeURIComponent(url.pathname.replace(/\?.*$/, ""));
    if (rel === "/" || rel === "/test/harness.html") rel = "/test/harness.html";
    const filePath = path.join(REPO_ROOT, rel);
    if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404).end("not found: " + rel); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });

  /** Resolves with the next collected payload matching `pred` (up to timeoutMs). */
  function waitFor(pred, timeoutMs = 15000) {
    const existing = collected.find((e) => pred(e.payload));
    if (existing) return Promise.resolve(existing.payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(fn);
        reject(new Error("waitFor: timeout after " + timeoutMs + "ms"));
      }, timeoutMs);
      const fn = (entry) => {
        if (pred(entry.payload)) {
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(entry.payload);
        }
      };
      listeners.add(fn);
    });
  }

  return {
    server,
    collected,
    waitFor,
    drain() { collected.length = 0; },
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          if (!quiet) console.log(`[serve] fixture server on http://127.0.0.1:${addr.port}`);
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
