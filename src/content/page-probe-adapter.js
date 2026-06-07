(function attachPageProbeAdapter(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildPageProbeAdapter() {
  const PAGE_PROBE_MARKER = "__chatNotifyPageProbeEnabled";

  function getHost(location) {
    return location && typeof location.hostname === "string" ? location.hostname.toLowerCase() : "";
  }

  function createPageProbeAdapter() {
    function matchesLocation(location) {
      return Boolean(getHost(location));
    }

    function getLifecycleBridgeConfig() {
      const host = getHost(globalThis.location);
      return {
        siteId: "page-probe",
        hosts: host ? [host] : [],
        generationRequestMatchers: [{ pathnameIncludes: "/" }],
        promptExtractor: "none",
        probeOnly: true,
      };
    }

    return {
      siteId: "page-probe",
      displayName: "Page Probe",
      canObserveLifecycle: true,
      completionStrategy: "probe_only",
      matchesLocation,
      getSessionKey: () => `probe:${getHost(globalThis.location)}`,
      isSendEvent: () => false,
      getPromptDraft: () => "",
      getLatestUserMessage: () => "",
      isResponding: () => false,
      getLatestAssistantSnapshot: () => "",
      observePage: () => () => {},
      normalizeLifecycleEvent: () => null,
      getLifecycleBridgeConfig,
    };
  }

  return {
    PAGE_PROBE_MARKER,
    createPageProbeAdapter,
  };
});
