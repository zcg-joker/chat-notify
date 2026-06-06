(function attachConstants(root, factory) {
  const exports = factory();
  root.ChatNotify = Object.assign({}, root.ChatNotify, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildConstants() {
  const SITE_IDS = Object.freeze({
    CHATGPT: "chatgpt",
  });

  const RESPONSE_STATES = Object.freeze({
    IDLE: "idle",
    PENDING_USER_MESSAGE: "pending_user_message",
    RESPONDING: "responding",
    SETTLING: "settling",
    COMPLETED: "completed",
    CANCELED: "canceled",
    ERROR_OR_UNKNOWN: "error_or_unknown",
  });

  const DEFAULTS = Object.freeze({
    PROMPT_EXCERPT_LIMIT: 40,
    RESPONSE_START_TIMEOUT_MS: 30000,
    RESPONSE_SETTLE_MS: 1800,
    RESPONSE_TOTAL_TIMEOUT_MS: 20 * 60 * 1000,
  });

  const STORAGE_KEYS = Object.freeze({
    ENABLED: "enabled",
  });

  return {
    SITE_IDS,
    RESPONSE_STATES,
    DEFAULTS,
    STORAGE_KEYS,
  };
});
