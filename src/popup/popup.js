(function installPopup() {
  const enabledToggle = document.getElementById("enabled-toggle");
  const debugLogsToggle = document.getElementById("debug-logs-toggle");
  const testButton = document.getElementById("test-notification");
  const siteStatus = document.getElementById("site-status");
  const extensionStatus = document.getElementById("extension-status");
  const notificationStatus = document.getElementById("notification-status");
  const notificationDetail = document.getElementById("notification-detail");
  const completionStatus = document.getElementById("completion-status");

  function shortError(value) {
    if (!value) {
      return "";
    }
    const message = typeof value === "string" ? value : value.message || String(value);
    return message.split("\n")[0].trim();
  }

  function renderNotificationHealth(notificationHealth) {
    const state = notificationHealth && notificationHealth.state;
    if (state === "working" || state === "ok") {
      notificationStatus.textContent = "Notifications working";
      notificationDetail.textContent = "";
      return;
    }
    if (state === "failed") {
      notificationStatus.textContent = "Notification failed";
      notificationDetail.textContent = shortError(notificationHealth.message);
      return;
    }
    notificationStatus.textContent = "Not tested yet";
    notificationDetail.textContent = "";
  }

  function renderLastCompletion(lastCompletion) {
    const state = lastCompletion && lastCompletion.state;
    if (state === "sent") {
      completionStatus.textContent = "Last notification sent";
      return;
    }
    if (state === "failed") {
      completionStatus.textContent = "Last notification failed";
      return;
    }
    completionStatus.textContent = "No completions yet";
  }

  function renderPopupStatus(response) {
    const status = response && (response.popupStatus || response.status);
    renderNotificationHealth(status && status.notificationHealth);
    renderLastCompletion(status && status.lastCompletion);
  }

  function renderExtensionStatus() {
    extensionStatus.textContent = enabledToggle.checked ? "Enabled" : "Disabled";
  }

  chrome.storage.sync.get({ enabled: true, debugLogs: false }, (settings) => {
    enabledToggle.checked = Boolean(settings.enabled);
    debugLogsToggle.checked = Boolean(settings.debugLogs);
    renderExtensionStatus();
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
    renderExtensionStatus();
    chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  debugLogsToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ debugLogs: debugLogsToggle.checked });
  });

  chrome.runtime.sendMessage({ type: ChatNotify.MESSAGE_TYPES.GET_POPUP_STATUS }, (response) => {
    if (chrome.runtime.lastError) {
      renderNotificationHealth({ state: "failed", message: chrome.runtime.lastError.message });
      return;
    }
    renderPopupStatus(response);
  });

  testButton.addEventListener("click", () => {
    chrome.runtime.sendMessage(ChatNotify.createTestNotificationMessage(), (response) => {
      if (chrome.runtime.lastError) {
        renderNotificationHealth({ state: "failed", message: chrome.runtime.lastError.message });
        return;
      }
      if (response && response.ok) {
        renderNotificationHealth({ state: "working", message: "" });
        return;
      }
      renderNotificationHealth({ state: "failed", message: response && response.error });
    });
  });
})();
