# Privacy Policy — WASMonkey

WASMonkey does not collect, transmit, or sell any personal data. All script
storage, patch caching, and settings live on your device via `chrome.storage.local`
and IndexedDB. No data leaves the device. No telemetry is sent by default.

Network access is used only when a script you install explicitly performs it
(gated by `@grant network`) or when you import a script from a URL.