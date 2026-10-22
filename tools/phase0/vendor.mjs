/**
 * vendor.mjs — vendor official browser builds of Binaryen.js and wabt.js.
 *
 * Phase 0 could not complete the toolkit spike because no browser builds were
 * available in the environment's npm cache. This script fixes that
 * reproducibly: it downloads the exact npm tarballs (registry.npmjs.org is
 * inside the sandbox egress allowlist) and extracts the single-file browser
 * builds into <repo>/vendor/:
 *
 *   vendor/binaryen/index.js  — binaryen@132.0.0 ESM build (top-level await,
 *                               default export = initialized API; WASM
 *                               embedded as base64, ~14.8 MB)
 *   vendor/wabt/index.js      — wabt@1.0.39 UMD build (global WabtModule
 *                               factory; WASM embedded as base64, ~0.7 MB)
 *
 * Both are the packages' own `index.js` files — i.e. the official builds, not
 * repacks. Checksums are pinned in tools/phase0/vendor.lock.json; re-running
 * verifies against the lock (use --update to re-pin).
 *
 * vendor/ is gitignored (large generated artifacts); the lockfile + this
 * script are committed so any checkout can recreate the exact bytes with:
 *   node tools/phase0/vendor.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileP = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, "..", "..");
const VENDOR_DIR = path.join(REPO_ROOT, "vendor");
const LOCK_PATH = path.join(HERE, "vendor.lock.json");

const PACKAGES = [
  {
    name: "binaryen",
    version: "132.0.0",
    dest: "binaryen",
    files: ["package/index.js", "package/LICENSE"],
    browserNote: "ESM, top-level await, default export; single-file (embedded base64 WASM)",
  },
  {
    name: "wabt",
    version: "1.0.39",
    dest: "wabt",
    files: ["package/index.js", "package/LICENSE"],
    browserNote: "UMD classic script exposing global WabtModule factory; single-file (embedded base64 WASM)",
  },
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fetchTarball(pkg) {
  const meta = await (await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`)).json();
  const url = meta.dist.tarball;
  const expected = meta.dist.shasum;
  const tmp = path.join(os.tmpdir(), `WASMonkey-vendor-${pkg.name}-${pkg.version}.tgz`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(tmp));
  const got = sha256(fs.readFileSync(tmp));
  // npm dist.shasum is sha1; verify integrity via sha1 as well
  const sha1 = crypto.createHash("sha1").update(fs.readFileSync(tmp)).digest("hex");
  if (sha1 !== expected) throw new Error(`shasum mismatch for ${pkg.name}: ${sha1} != ${expected}`);
  return { tmp, tarballUrl: url, sha256: got };
}

export async function vendor({ update = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log("[vendor]", ...a);
  let lock = null;
  if (fs.existsSync(LOCK_PATH)) lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));

  const out = { generatedAt: lock?.generatedAt || new Date().toISOString(), packages: [] };
  for (const pkg of PACKAGES) {
    const destDir = path.join(VENDOR_DIR, pkg.dest);
    const locked = lock?.packages?.find((p) => p.name === pkg.name);
    if (!update && locked && locked.version === pkg.version) {
      const localOk = locked.files.every((f) => {
        const p = path.join(VENDOR_DIR, pkg.dest, path.basename(f.from));
        return fs.existsSync(p) && sha256(fs.readFileSync(p)) === f.sha256;
      });
      if (localOk) {
        log(`${pkg.name}@${pkg.version} already vendored and verified against lock`);
        out.packages.push(locked);
        continue;
      }
      log(`${pkg.name}: lock present but files missing/mismatched — re-vendoring`);
    }

    log(`fetching ${pkg.name}@${pkg.version} from registry.npmjs.org`);
    const { tmp, tarballUrl, sha256: tarballSha } = await fetchTarball(pkg);
    fs.mkdirSync(destDir, { recursive: true });
    await execFileP("tar", ["xzf", tmp, "-C", destDir, "--strip-components=1", ...pkg.files]);
    fs.unlinkSync(tmp);

    const entry = {
      name: pkg.name,
      version: pkg.version,
      tarball: tarballUrl,
      tarballSha256: tarballSha,
      browserNote: pkg.browserNote,
      files: pkg.files.map((f) => {
        const local = path.join(destDir, path.basename(f));
        return { from: f, to: `vendor/${pkg.dest}/${path.basename(f)}`, sha256: sha256(fs.readFileSync(local)), bytes: fs.statSync(local).size };
      }),
    };
    out.packages.push(entry);
    log(`  vendored ${entry.files.map((f) => `${f.to} (${(f.bytes / 1e6).toFixed(2)} MB)`).join(", ")}`);
  }

  out.generatedAt = new Date().toISOString();
  fs.writeFileSync(LOCK_PATH, JSON.stringify(out, null, 2) + "\n");
  log("lockfile written:", LOCK_PATH);
  return out;
}

/** True when vendor files exist and match the lockfile. */
export function vendorReady() {
  if (!fs.existsSync(LOCK_PATH)) return false;
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  return (lock.packages || []).every((p) =>
    (p.files || []).every((f) => {
      const abs = path.join(REPO_ROOT, f.to);
      return fs.existsSync(abs) && sha256(fs.readFileSync(abs)) === f.sha256;
    })
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(HERE, "vendor.mjs")) {
  await vendor({ update: process.argv.includes("--update") });
}
