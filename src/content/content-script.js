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

  function sendCompletion(event) {
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
    if (!adapter.isSendEvent(event)) {
      return;
    }

    window.setTimeout(() => controller.handleUserSend(), 0);
  }

  function handleLifecycleMessage(event) {
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

  chrome.storage.sync.get({ enabled: true }, (settings) => {
    if (!settings.enabled) {
      return;
    }

    installLifecycleBridge();
    document.addEventListener("click", handlePossibleSend, true);
    document.addEventListener("keydown", handlePossibleSend, true);
    window.addEventListener("message", handleLifecycleMessage);
    window.setInterval(() => controller.tick(), 500);
  });
})();
