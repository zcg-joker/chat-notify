(function installPopup() {
  const enabledToggle = document.getElementById("enabled-toggle");
  const debugLogsToggle = document.getElementById("debug-logs-toggle");
  const testButton = document.getElementById("test-notification");
  const siteStatus = document.getElementById("site-status");

  chrome.storage.sync.get({ enabled: true, debugLogs: false }, (settings) => {
    enabledToggle.checked = Boolean(settings.enabled);
    debugLogsToggle.checked = Boolean(settings.debugLogs);
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    let url = null;
    try {
      url = tabs[0] && tabs[0].url ? new URL(tabs[0].url) : null;
    } catch (_error) {
      url = null;
    }

    const supported = url && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com");
    siteStatus.textContent = supported ? "Current page is supported" : "Current page is not supported";
  });

  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  debugLogsToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ debugLogs: debugLogsToggle.checked });
  });

  testButton.addEventListener("click", () => {
    chrome.runtime.sendMessage(ChatNotify.createTestNotificationMessage());
  });
})();
