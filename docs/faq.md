# FAQ

**Q: Does WASMonkey send my data anywhere?**
A: No. Everything stays on your device.

**Q: Why does it need `<all_urls>`?**
A: To inject the hook on any page that uses WebAssembly.

**Q: A script broke my page.**
A: Use the panic switch (global disable / per-site disable) in the popup.

**Q: Chrome says "Unsafe" during review?**
A: The extension is a userscript manager for WASM; sideload via docs/sideload.md if rejected.