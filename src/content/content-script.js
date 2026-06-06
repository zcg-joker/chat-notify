(function installChatNotifyContentScript() {
  const api = globalThis.ChatNotify;
  if (!api || globalThis.__chatNotifyContentScriptInstalled) {
    return;
  }
  globalThis.__chatNotifyContentScriptInstalled = true;

  const adapters = [api.createChatGptAdapter()];
  const adapter = adapters.find((candidate) => candidate.matchesLocation(window.location));

  if (!adapter) {
    return;
  }

  let enabled = false;

  function sendCompletion(event) {
    if (!enabled) {
      return;
    }
    chrome.runtime.sendMessage(api.createResponseCompletedMessage(event));
  }

  function installLifecycleBridge() {
    if (!adapter.canObserveLifecycle) {
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content/page-lifecycle-bridge.js");
    script.onload = () => script.remove();
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
      controller.handleLifecycleEvent(normalized);
    }
  }

  function handleTick() {
    if (enabled) {
      controller.tick();
    }
  }

  function installObservers() {
    installLifecycleBridge();
    document.addEventListener("click", handlePossibleSend, true);
    document.addEventListener("keydown", handlePossibleSend, true);
    window.addEventListener("message", handleLifecycleMessage);
    window.setInterval(handleTick, 500);
  }

  if (chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes.enabled) {
        enabled = Boolean(changes.enabled.newValue);
      }
    });
  }

  chrome.storage.sync.get({ enabled: true }, (settings) => {
    enabled = Boolean(settings.enabled);
    if (!enabled) {
      return;
    }

    installObservers();
  });
})();
