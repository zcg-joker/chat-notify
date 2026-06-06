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
  });

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createResponseCompletedMessage(input) {
    return {
      type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
      payload: {
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        sessionKey: cleanString(input.sessionKey),
        sourceTabId: Number.isFinite(input.sourceTabId) ? input.sourceTabId : null,
        promptExcerpt: cleanString(input.promptExcerpt),
        completedAt: Number.isFinite(input.completedAt) ? input.completedAt : Date.now(),
      },
    };
  }

  function createTestNotificationMessage() {
    return {
      type: MESSAGE_TYPES.TEST_NOTIFICATION,
      payload: {},
    };
  }

  return {
    MESSAGE_TYPES,
    createResponseCompletedMessage,
    createTestNotificationMessage,
  };
});
