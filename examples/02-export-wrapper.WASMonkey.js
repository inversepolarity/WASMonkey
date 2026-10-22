// ==WASMonkeyScript==
// @name        Export wrapper
// @match       *
// @grant       patchBytes patchExports
// @version     1.0
// ==/WASMonkeyScript==

WASMonkey.onAfterInstantiate((exports, ctx) => {
  if (exports && typeof exports.add === "function") {
    const orig = exports.add;
    exports.add = function (a, b) {
      WASMonkey.log("add called with", a, b);
      return orig(a, b);
    };
  }
});