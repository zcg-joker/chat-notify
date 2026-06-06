(function attachAdapterContract(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildAdapterContract() {
  const REQUIRED_ADAPTER_METHODS = Object.freeze([
    "matchesLocation",
    "getSessionKey",
    "isSendEvent",
    "getPromptDraft",
    "getLatestUserMessage",
    "isResponding",
    "getLatestAssistantSnapshot",
    "observePage",
    "normalizeLifecycleEvent",
  ]);

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      return false;
    }
    return REQUIRED_ADAPTER_METHODS.every((method) => typeof adapter[method] === "function");
  }

  return {
    REQUIRED_ADAPTER_METHODS,
    validateAdapter,
  };
});
