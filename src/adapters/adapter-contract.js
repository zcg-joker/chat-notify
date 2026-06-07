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
    "getLifecycleBridgeConfig",
  ]);
  const REQUIRED_ADAPTER_METADATA = Object.freeze({
    siteId: "string",
    displayName: "string",
    canObserveLifecycle: "boolean",
  });

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      return false;
    }
    const hasMethods = REQUIRED_ADAPTER_METHODS.every(
      (method) => typeof adapter[method] === "function"
    );
    const hasMetadata = Object.entries(REQUIRED_ADAPTER_METADATA).every(
      ([field, type]) => typeof adapter[field] === type
    );
    return hasMethods && hasMetadata;
  }

  return {
    REQUIRED_ADAPTER_METHODS,
    REQUIRED_ADAPTER_METADATA,
    validateAdapter,
  };
});
