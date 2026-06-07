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
  const LOG_PREFIX = "[Chat Notify]";
  const NOTIFICATION_ICON_PATH = "assets/icon-128.png";

  function log(level, message, detail) {
    if (typeof console === "undefined" || typeof console[level] !== "function") {
      return;
    }
    if (detail === undefined) {
      console[level](LOG_PREFIX, message);
      return;
    }
    console[level](LOG_PREFIX, message, detail);
  }

  function sanitizeNotificationIdPart(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
  }

  function resolveNotificationIcon(chromeApi) {
    if (chromeApi && chromeApi.runtime && typeof chromeApi.runtime.getURL === "function") {
      return chromeApi.runtime.getURL(NOTIFICATION_ICON_PATH);
    }
    return NOTIFICATION_ICON_PATH;
  }

  function buildCompletionNotification(payload, chromeApi) {
    const displayName = payload.displayName || "AI";
    const promptExcerpt = payload.promptExcerpt || "";
    return {
      type: "basic",
      iconUrl: resolveNotificationIcon(chromeApi),
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

    function getEnabled() {
      return new Promise((resolve) => {
        if (!chromeApi.storage || !chromeApi.storage.sync || typeof chromeApi.storage.sync.get !== "function") {
          resolve(true);
          return;
        }

        try {
          chromeApi.storage.sync.get({ enabled: true }, (settings) => {
            const lastError = chromeApi.runtime && chromeApi.runtime.lastError;
            if (lastError) {
              resolve(true);
              return;
            }
            resolve(Boolean(settings.enabled));
          });
        } catch (_error) {
          resolve(true);
        }
      });
    }

    async function handleMessage(message, sender = {}) {
      log("debug", "background message received", { type: message && message.type, senderTabId: sender.tab && sender.tab.id });
      if (message && message.type === MESSAGE_TYPES.TEST_NOTIFICATION) {
        const id = `chat-notify:test:${now()}`;
        const notificationResult = await notify(id, {
          type: "basic",
          iconUrl: resolveNotificationIcon(chromeApi),
          title: "Chat Notify test",
          message: "Notifications are working",
          priority: 1,
        });
        if (!notificationResult.ok) {
          log("warn", "test notification failed", notificationResult.error);
          return { ok: false, error: notificationResult.error, notificationId: id };
        }
        log("info", "test notification created", id);
        return { ok: true, notificationId: id };
      }

      if (!message || message.type !== MESSAGE_TYPES.AI_RESPONSE_COMPLETED) {
        log("debug", "background message ignored");
        return { ok: false, ignored: true };
      }

      if (!(await getEnabled())) {
        log("info", "completion notification ignored because extension is disabled");
        return { ok: false, ignored: true, disabled: true };
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

      const notificationResult = await notify(id, buildCompletionNotification(payload, chromeApi));
      if (!notificationResult.ok) {
        log("warn", "completion notification failed", notificationResult.error);
        return { ok: false, error: notificationResult.error, notificationId: id };
      }
      log("info", "completion notification created", {
        notificationId: id,
        siteId: payload.siteId,
        sessionKey: payload.sessionKey,
      });
      return { ok: true, notificationId: id };
    }

    return {
      handleMessage,
      buildCompletionNotification,
      resolveNotificationIcon: () => resolveNotificationIcon(chromeApi),
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
    resolveNotificationIcon,
  };
});
