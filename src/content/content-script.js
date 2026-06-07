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
  if (typeof api.createGeminiAdapter === "function") {
    adapters.push(api.createGeminiAdapter());
  }
  const adapter = adapters.find((candidate) => candidate.matchesLocation(window.location));

  if (!adapter) {
    log("info", "content script skipped: unsupported page", { href: window.location.href });
    return;
  }
  log("info", "adapter selected", { siteId: adapter.siteId, displayName: adapter.displayName });

  let enabled = false;
  let observersInstalled = false;
  let flowCounter = 0;
  let currentPendingFlowId = "";
  const flowIdByLifecycleId = new Map();
  const flowIdBySessionKey = new Map();

  const diagnosticTypeByLifecycleType = {
    GENERATION_STARTED: "lifecycle_started",
    GENERATION_COMPLETED: "lifecycle_completed",
    GENERATION_FAILED: "lifecycle_failed",
    GENERATION_CANCELED: "lifecycle_canceled",
  };

  function createFlowId() {
    flowCounter += 1;
    return `${adapter.siteId}:${Date.now()}:${flowCounter}`;
  }

  function sendDiagnosticEvent(input) {
    if (typeof api.createDiagnosticEventMessage !== "function") {
      return;
    }
    chrome.runtime.sendMessage(api.createDiagnosticEventMessage(Object.assign({
      flowId: currentPendingFlowId,
      siteId: adapter.siteId,
      displayName: adapter.displayName,
    }, input || {})), () => {
      const lastError = chrome.runtime && chrome.runtime.lastError;
      if (lastError) {
        log("debug", "diagnostic message failed", lastError.message || String(lastError));
      }
    });
  }

  function bindSessionFlow(sessionKey, flowId) {
    if (typeof sessionKey === "string" && sessionKey && typeof flowId === "string" && flowId) {
      flowIdBySessionKey.set(sessionKey, flowId);
    }
  }

  function resolveLifecycleFlowId(normalized) {
    const lifecycleId = normalized && normalized.lifecycleId;
    if (
      typeof lifecycleId === "string" &&
      lifecycleId &&
      flowIdByLifecycleId.has(lifecycleId)
    ) {
      return flowIdByLifecycleId.get(lifecycleId);
    }

    const sessionKey = normalized && normalized.sessionKey;
    if (
      typeof sessionKey === "string" &&
      sessionKey &&
      flowIdBySessionKey.has(sessionKey)
    ) {
      return flowIdBySessionKey.get(sessionKey);
    }

    return currentPendingFlowId;
  }

  function bindLifecycleFlow(normalized, flowId) {
    if (!normalized || typeof flowId !== "string" || !flowId) {
      return;
    }
    if (typeof normalized.lifecycleId === "string" && normalized.lifecycleId) {
      flowIdByLifecycleId.set(normalized.lifecycleId, flowId);
    }
    bindSessionFlow(normalized.sessionKey, flowId);
  }

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

  function postBridgeConfig() {
    if (!adapter.canObserveLifecycle || typeof adapter.getLifecycleBridgeConfig !== "function") {
      return;
    }
    window.postMessage(
      {
        source: "chat-notify-content-script",
        type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
        config: adapter.getLifecycleBridgeConfig(),
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
    chrome.runtime.sendMessage(
      api.createResponseCompletedMessage(Object.assign({}, event, {
        flowId:
          event.flowId ||
          (typeof event.sessionKey === "string" && flowIdBySessionKey.get(event.sessionKey)) ||
          currentPendingFlowId,
      })),
      (response) => {
        const lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError) {
          log("warn", "completion message failed", lastError.message || String(lastError));
          return;
        }
        log("info", "completion message acknowledged", response);
      }
    );
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
      postBridgeConfig();
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
    currentPendingFlowId = createFlowId();
    sendDiagnosticEvent({ eventType: "send_captured", flowId: currentPendingFlowId });
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

    if (data.detail && data.detail.eventType === "request_probe") {
      const request = {
        requestKind: data.detail.requestKind || "",
        method: data.detail.method || "",
        host: data.detail.host || "",
        path: data.detail.path || "",
        matched: Boolean(data.detail.matched),
        reason: data.detail.reason || "",
      };
      const message = [
        request.requestKind,
        request.method,
        `${request.host}${request.path}`,
        request.reason,
      ].filter(Boolean).join(" ");
      sendDiagnosticEvent({
        eventType: request.matched ? "request_probe_matched" : "request_probe_ignored",
        message,
        request,
      });
      return;
    }

    const normalized = adapter.normalizeLifecycleEvent(data.detail);
    if (normalized) {
      const diagnosticEventType = diagnosticTypeByLifecycleType[normalized.type];
      const flowId = resolveLifecycleFlowId(normalized);
      log("info", "lifecycle event received", {
        type: normalized.type,
        lifecycleId: normalized.lifecycleId,
        url: normalized.url,
      });
      if (normalized.type === "GENERATION_STARTED") {
        bindLifecycleFlow(normalized, flowId);
      } else {
        bindSessionFlow(normalized.sessionKey, flowId);
      }
      if (diagnosticEventType) {
        sendDiagnosticEvent({
          flowId,
          eventType: diagnosticEventType,
          status: normalized.type === "GENERATION_FAILED" ? "failed" : "ok",
          message: normalized.errorMessage || normalized.message || "",
          promptExcerpt: normalized.promptExcerpt || "",
        });
      }
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
