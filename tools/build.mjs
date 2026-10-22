import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const target = process.argv[2] || "chrome";
const out = path.join(ROOT, "dist", target);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Copy src, ui, examples, docs, vendor (optional) — shallow copy of src tree.
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(ROOT, "src"), path.join(out, "src"));
// Copy icons if present.
const iconsDir = path.join(ROOT, "icons");
if (fs.existsSync(iconsDir)) copyDir(iconsDir, path.join(out, "icons"));

// Per-browser manifest tweaks.
const base = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
if (target === "firefox") {
  // Firefox MV3 supports world:MAIN; keep as is. Add gecko settings already present.
} else if (target === "safari") {
  // Safari: drop world:MAIN from content_scripts (fallback injection path is primary).
  base.content_scripts = base.content_scripts.map((cs) => {
    const { world, ...rest } = cs;
    return rest;
  });
} else if (target === "chrome") {
  // Chrome: default manifest.
}

fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(base, null, 2));
console.log("built", target, "->", out);
