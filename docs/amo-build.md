# AMO Source Review Notes

- Vendored libraries: `vendor/binaryen/index.js`, `vendor/wabt/index.js` (checksum-pinned in `tools/phase0/vendor.lock.json`).
- Regenerate with `node tools/phase0/vendor.mjs`.
- Build: `node tools/build.mjs firefox`.
- The extension uses no minified first-party code; `src/` is readable. Bundled `options.bundle.js` is generated via esbuild from `src/ui/options.js` (source included).