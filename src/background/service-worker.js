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
        try {
          chromeApi.notifications.create(id, optionsForNotification, (createdId) => {
            const lastError = chromeApi.runtime && chromeApi.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true, createdId });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
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

      const notificationResult = await notify(id, buildCompletionNotification(payload));
      if (!notificationResult.ok) {
        return { ok: false, error: notificationResult.error, notificationId: id };
      }
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
      service
        .handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error),
          });
        });
      return true;
    });
  }

  return {
    createNotificationService,
    buildCompletionNotification,
  };
});
