/**
 * browser.mjs — provisioning + launch resolution for the Phase 0 follow-up run.
 *
 * The sandbox egress allowlist includes registry.npmjs.org, so we provision a
 * headless-capable Chromium from the `@sparticuz/chromium` npm package
 * (v153.0.0): a full (unbranded) Chromium 153 build that statically links
 * everything except NSS/NSPR/expat, which the package ships alongside it in
 * `al2023.tar.br`, plus bundled fonts and SwiftShader.
 *
 * The extracted browser lives OUTSIDE the repo (default
 * ~/.cache/WASMonkey/chromium-153) so no browser bytes ever enter git.
 *
 * resolveBrowser() returns { executablePath, env, version, cacheDir } and
 * downloads/extracts on first use (idempotent afterwards).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const PKG_VERSION = "153.0.0";
const TARBALL_URL = `https://registry.npmjs.org/@sparticuz/chromium/-/chromium-${PKG_VERSION}.tgz`;
export const DEFAULT_CACHE_DIR = path.join(
  process.env.WASMonkey_BROWSER_CACHE || path.join(os.homedir(), ".cache", "WASMonkey"),
  `chromium-${PKG_VERSION.split(".")[0]}`
);

async function brotliToFile(srcPath, dstPath) {
  await pipeline(
    fs.createReadStream(srcPath),
    zlib.createBrotliDecompress(),
    fs.createWriteStream(dstPath)
  );
}

/** Downloads and extracts the browser into cacheDir. Idempotent. */
export async function setupBrowser({ cacheDir = DEFAULT_CACHE_DIR, quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log("[browser]", ...a);
  const exe = path.join(cacheDir, "chromium");
  if (fs.existsSync(exe) && fs.existsSync(path.join(cacheDir, "al2023", "lib", "libnss3.so"))) {
    log("already provisioned at", cacheDir);
    return cacheDir;
  }
  fs.mkdirSync(cacheDir, { recursive: true });

  const tgz = path.join(cacheDir, "chromium.tgz");
  if (!fs.existsSync(tgz)) {
    log("downloading", TARBALL_URL);
    const res = await fetch(TARBALL_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    await pipeline(res.body, fs.createWriteStream(tgz));
    log("downloaded", (fs.statSync(tgz).size / 1e6).toFixed(1) + " MB");
  }

  log("extracting npm package");
  await execFileP("tar", ["xzf", tgz, "-C", cacheDir, "--strip-components=1"]);

  const binDir = path.join(cacheDir, "bin");
  log("decompressing brotli payloads");
  await brotliToFile(path.join(binDir, "chromium.br"), exe);
  fs.chmodSync(exe, 0o755);

  for (const [src, dst] of [
    ["al2023.tar.br", "al2023.tar"],
    ["fonts.tar.br", "fonts.tar"],
    ["swiftshader.tar.br", "swiftshader.tar"],
  ]) {
    const tarPath = path.join(cacheDir, src.replace(/\.br$/, ""));
    if (!fs.existsSync(tarPath)) await brotliToFile(path.join(binDir, src), tarPath);
    const outDir = path.join(cacheDir, path.basename(tarPath, ".tar"));
    fs.mkdirSync(outDir, { recursive: true });
    await execFileP("tar", ["xf", tarPath, "-C", outDir]);
  }

  // sanity: ask the binary for its version
  const env = launchEnv(cacheDir);
  const { stdout } = await execFileP(exe, ["--version"], { env });
  log("provisioned:", stdout.trim());
  return cacheDir;
}

/** Environment (LD_LIBRARY_PATH etc.) needed to run the provisioned binary. */
export function launchEnv(cacheDir = DEFAULT_CACHE_DIR) {
  const parts = [
    path.join(cacheDir, "al2023", "lib"),
    path.join(cacheDir, "swiftshader"),
    process.env.LD_LIBRARY_PATH,
  ].filter(Boolean);
  return {
    ...process.env,
    LD_LIBRARY_PATH: parts.join(path.delimiter),
    // use the bundled fontconfig + fonts (sandbox has no system fonts)
    FONTCONFIG_PATH: path.join(cacheDir, "fonts"),
  };
}

/** Ensures the browser exists and returns launch info. */
export async function resolveBrowser({ cacheDir = DEFAULT_CACHE_DIR, quiet = false } = {}) {
  const dir = await setupBrowser({ cacheDir, quiet });
  const exe = path.join(dir, "chromium");
  const env = launchEnv(dir);
  const { stdout } = await execFileP(exe, ["--version"], { env });
  return { executablePath: exe, env, cacheDir: dir, version: stdout.trim() };
}

/** Standard launch flags for extension testing in this sandbox. */
export function launchArgs({ repoRoot }) {
  return [
    "--no-sandbox", // unprivileged container user; no user namespaces available
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
  ];
}
