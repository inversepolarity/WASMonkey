// ==WasMonkeyScript==
// @name        Export wrapper
// @match       *
// @grant       patchBytes patchExports
// @version     1.0
// ==/WasMonkeyScript==

wasMonkey.onAfterInstantiate((exports, ctx) => {
  if (exports && typeof exports.add === "function") {
    const orig = exports.add;
    exports.add = function (a, b) {
      wasMonkey.log("add called with", a, b);
      return orig(a, b);
    };
  }
});