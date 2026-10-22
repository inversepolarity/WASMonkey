# Sideloading / Manual Install

## Chrome / Chromium
1. Open `chrome://extensions`, enable Developer mode.
2. Click "Load unpacked" and select the extension directory (or `dist/chrome`).

## Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on" and select `manifest.json`.

## Self-hosted
Build with `node tools/build.mjs <chrome|firefox>`, then zip the `dist/<target>` directory.