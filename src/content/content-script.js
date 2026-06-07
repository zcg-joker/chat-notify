(function installChatNotifyContentScript() {
  const LOG_PREFIX = "[Chat Notify]";
  let debugLogs = false;

  function log(level, message, detail) {
    if (!debugLogs || typeof console === "undefined" || typeof console[level] !== "function") {
      return;
    }
    if (detail === undefined) {
      console[level](LOG_PREFIX, message);
      return;
    }
    console[level](LOG_PREFIX, message, detail);
  }

  const api = globalThis.ChatNotify;
  if (!api || globalThis.__chatNotifyContentScriptInstalled) {
    if (!api) {
      log("warn", "content script skipped: ChatNotify API is unavailable");
    }
    return;
  }
  globalThis.__chatNotifyContentScriptInstalled = true;
  log("info", "content script loaded", { href: window.location.href });

  const adapters = [api.createChatGptAdapter()];
  const adapter = adapters.find((candidate) => candidate.matchesLocation(window.location));

  if (!adapter) {
    log("info", "content script skipped: unsupported page", { href: window.location.href });
    return;
  }
  log("info", "adapter selected", { siteId: adapter.siteId, displayName: adapter.displayName });

  let enabled = false;
  let observersInstalled = false;

  function postDebugStateToBridge() {
    window.postMessage(
      {
        source: "chat-notify-content-script",
        type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
        debugLogs,
      },
      window.location.origin
    );
  }

  function sendCompletion(event) {
    if (!enabled) {
      log("debug", "completion ignored because extension is disabled", {
        sessionKey: event && event.sessionKey,
      });
      return;
    }
    log("info", "sending completion message", {
      sessionKey: event.sessionKey,
      promptExcerpt: event.promptExcerpt,
    });
    chrome.runtime.sendMessage(api.createResponseCompletedMessage(event), (response) => {
      const lastError = chrome.runtime && chrome.runtime.lastError;
      if (lastError) {
        log("warn", "completion message failed", lastError.message || String(lastError));
        return;
      }
      log("info", "completion message acknowledged", response);
    });
  }

  function installLifecycleBridge() {
    if (!adapter.canObserveLifecycle) {
      log("warn", "lifecycle bridge not installed: adapter cannot observe lifecycle");
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content/page-lifecycle-bridge.js");
    script.onload = () => {
      log("info", "page lifecycle bridge injected");
      postDebugStateToBridge();
      script.remove();
    };
    script.onerror = () => {
      log("warn", "page lifecycle bridge failed to load", { src: script.src });
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  const controller = api.createMonitorController({
    adapter,
    root: document,
    sourceTabId: null,
    onCompleted: sendCompletion,
  });

  function handlePossibleSend(event) {
    if (!enabled) {
      return;
    }

    if (!adapter.isSendEvent(event)) {
      return;
    }

    log("info", "user send captured", {
      eventType: event.type,
      sessionKey:
        typeof adapter.getSessionKey === "function"
          ? adapter.getSessionKey(window.location, document)
          : "",
    });
    controller.handleUserSend();
  }

  function handleLifecycleMessage(event) {
    if (!enabled) {
      return;
    }

    if (event.source !== window) {
      return;
    }

    const data = event.data || {};
    if (data.source !== "chat-notify-page-lifecycle-bridge") {
      return;
    }

    const normalized = adapter.normalizeLifecycleEvent(data.detail);
    if (normalized) {
      log("info", "lifecycle event received", {
        type: normalized.type,
        lifecycleId: normalized.lifecycleId,
        url: normalized.url,
      });
      controller.handleLifecycleEvent(normalized);
      return;
    }
    log("debug", "lifecycle event ignored by adapter", data.detail);
  }

  function handleTick() {
    if (enabled) {
      controller.tick();
    }
  }

  function installObservers() {
    if (observersInstalled) {
      log("debug", "observers already installed");
      return;
    }
    observersInstalled = true;

    installLifecycleBridge();
    document.addEventListener("click", handlePossibleSend, true);
    document.addEventListener("keydown", handlePossibleSend, true);
    window.addEventListener("message", handleLifecycleMessage);
    window.setInterval(handleTick, 500);
    log("info", "observers installed");
  }

  if (chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      if (changes.debugLogs) {
        debugLogs = Boolean(changes.debugLogs.newValue);
        log("info", "debug log state changed", { debugLogs });
        postDebugStateToBridge();
      }

      if (changes.enabled) {
        enabled = Boolean(changes.enabled.newValue);
        log("info", "enabled state changed", { enabled });
        if (enabled) {
          installObservers();
        }
      }
    });
  }

  chrome.storage.sync.get({ enabled: true, debugLogs: false }, (settings) => {
    enabled = Boolean(settings.enabled);
    debugLogs = Boolean(settings.debugLogs);
    log("info", "initial enabled state loaded", { enabled });
    if (!enabled) {
      return;
    }

    installObservers();
  });
})();
