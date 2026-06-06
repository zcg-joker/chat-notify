(function attachBackground(root, factory) {
  if (
    typeof importScripts === "function" &&
    !(root.ChatNotify && root.ChatNotify.MESSAGE_TYPES)
  ) {
    importScripts("../shared/messages.js");
  }
  const existing = root.ChatNotify || {};
  const messages =
    existing.MESSAGE_TYPES
      ? existing
      : typeof require === "function"
        ? require("../shared/messages.js")
        : existing;
  const exports = factory(messages);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildBackground(messages) {
  const { MESSAGE_TYPES } = messages;

  function sanitizeNotificationIdPart(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
  }

  function buildCompletionNotification(payload) {
    const displayName = payload.displayName || "AI";
    const promptExcerpt = payload.promptExcerpt || "";
    return {
      type: "basic",
      iconUrl: "assets/icon.svg",
      title: `${displayName} response complete`,
      message: promptExcerpt ? `"${promptExcerpt}" is ready` : "Your response is ready",
      priority: 1,
    };
  }

  function createNotificationService(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    function notify(id, optionsForNotification) {
      return new Promise((resolve) => {
        chromeApi.notifications.create(id, optionsForNotification, (createdId) => {
          resolve(createdId);
        });
      });
    }

    async function handleMessage(message, sender = {}) {
      if (!message || message.type !== MESSAGE_TYPES.AI_RESPONSE_COMPLETED) {
        return { ok: false, ignored: true };
      }

      const payload = message.payload || {};
      const sourceTabId =
        Number.isFinite(payload.sourceTabId) ? payload.sourceTabId : sender.tab && sender.tab.id;
      const id = [
        "chat-notify",
        sanitizeNotificationIdPart(payload.siteId),
        sanitizeNotificationIdPart(payload.sessionKey),
        sanitizeNotificationIdPart(sourceTabId),
        now(),
      ].join(":");

      await notify(id, buildCompletionNotification(payload));
      return { ok: true, notificationId: id };
    }

    return {
      handleMessage,
      buildCompletionNotification,
    };
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    const service = createNotificationService({ chromeApi: chrome });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      service.handleMessage(message, sender).then(sendResponse);
      return true;
    });
  }

  return {
    createNotificationService,
    buildCompletionNotification,
  };
});
