(function attachDomWatch(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildDomWatch() {
  function observeDom(root, callback) {
    if (!root || typeof MutationObserver === "undefined") {
      return () => {};
    }
    const observer = new MutationObserver(() => callback());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }

  return {
    observeDom,
  };
});
