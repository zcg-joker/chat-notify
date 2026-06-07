(function attachMessages(root, factory) {
  const exports = factory();
  root.ChatNotify = Object.assign({}, root.ChatNotify, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildMessages() {
  const MESSAGE_TYPES = Object.freeze({
    AI_RESPONSE_COMPLETED: "AI_RESPONSE_COMPLETED",
    TEST_NOTIFICATION: "TEST_NOTIFICATION",
    GET_POPUP_STATUS: "GET_POPUP_STATUS",
    SET_ENABLED: "SET_ENABLED",
    LIFECYCLE_EVENT: "CHAT_NOTIFY_LIFECYCLE_EVENT",
    DIAGNOSTIC_EVENT: "DIAGNOSTIC_EVENT",
  });

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createPromptExcerpt(value, limit = 40) {
    const normalized = cleanString(value).replace(/\s+/g, " ");
    const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 40;
    const characters = Array.from(normalized);
    if (characters.length === 0) {
      return "";
    }
    if (characters.length <= safeLimit) {
      return normalized;
    }
    return `${characters.slice(0, safeLimit).join("")}...`;
  }

  function sanitizePath(value) {
    const raw = cleanString(value);
    if (!raw) {
      return "";
    }
    try {
      return new URL(raw, "https://example.invalid").pathname;
    } catch (_error) {
      return raw.split("?")[0].split("#")[0];
    }
  }

  function sanitizeRequestProbe(input = {}) {
    const requestKind = cleanString(input.requestKind).toLowerCase();
    const method = cleanString(input.method).toUpperCase();
    const host = cleanString(input.host).toLowerCase();
    const path = sanitizePath(input.path);
    const reason = cleanString(input.reason);
    if (!requestKind && !method && !host && !path && !reason) {
      return null;
    }
    return {
      requestKind,
      method,
      host,
      path,
      matched: Boolean(input.matched),
      reason,
    };
  }

  function createResponseCompletedMessage(input = {}) {
    return {
      type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
      payload: {
        flowId: cleanString(input.flowId),
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        sessionKey: cleanString(input.sessionKey),
        sourceTabId: Number.isFinite(input.sourceTabId) ? input.sourceTabId : null,
        promptExcerpt: cleanString(input.promptExcerpt),
        completedAt: Number.isFinite(input.completedAt) ? input.completedAt : Date.now(),
      },
    };
  }

  function createDiagnosticEventMessage(input = {}) {
    const payload = {
      type: MESSAGE_TYPES.DIAGNOSTIC_EVENT,
      payload: {
        flowId: cleanString(input.flowId),
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        promptExcerpt: createPromptExcerpt(input.promptExcerpt || ""),
        eventType: cleanString(input.eventType),
        status: input.status === "failed" ? "failed" : "ok",
        message: typeof input.message === "string" ? input.message.split("\n")[0].trim() : "",
      },
    };
    const request = sanitizeRequestProbe(input.request || input);
    if (request) {
      payload.payload.request = request;
    }
    return payload;
  }

  function createTestNotificationMessage() {
    return {
      type: MESSAGE_TYPES.TEST_NOTIFICATION,
      payload: {},
    };
  }

  return {
    MESSAGE_TYPES,
    createDiagnosticEventMessage,
    createResponseCompletedMessage,
    createTestNotificationMessage,
  };
});
