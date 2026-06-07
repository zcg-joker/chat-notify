(function installPopup() {
  const enabledToggle = document.getElementById("enabled-toggle");
  const debugLogsToggle = document.getElementById("debug-logs-toggle");
  const testButton = document.getElementById("test-notification");
  const siteStatus = document.getElementById("site-status");
  const extensionStatus = document.getElementById("extension-status");
  const notificationStatus = document.getElementById("notification-status");
  const notificationDetail = document.getElementById("notification-detail");
  const completionStatus = document.getElementById("completion-status");
  const activitySummary = document.getElementById("activity-summary");
  const activitySite = document.getElementById("activity-site");
  const activityPrompt = document.getElementById("activity-prompt");
  const activityTimeline = document.getElementById("activity-timeline");

  const ACTIVITY_LABELS = {
    send_captured: "Send captured",
    lifecycle_started: "Generation started",
    lifecycle_completed: "Generation completed",
    lifecycle_failed: "Generation failed",
    lifecycle_canceled: "Generation canceled",
    notification_sent: "Notification sent",
    notification_failed: "Notification failed",
    notification_focus_succeeded: "Notification focused",
    notification_focus_failed: "Focus failed",
    request_probe_matched: "Request matched",
    request_probe_ignored: "Request ignored",
  };

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

  function activityLabel(event) {
    const eventType = event && (event.eventType || event.type);
    const label = ACTIVITY_LABELS[eventType] || "Unknown event";
    const request = event && event.request;
    if (
      (eventType === "request_probe_matched" || eventType === "request_probe_ignored") &&
      request &&
      (request.requestKind || request.method || request.host || request.path)
    ) {
      return `${label} (${[
        request.requestKind,
        request.method,
        `${request.host || ""}${request.path || ""}`,
      ].filter(Boolean).join(" ")})`;
    }
    return label;
  }

  function renderDiagnostics(diagnostics) {
    const flow = diagnostics && diagnostics.latestFlow;
    const events = flow && Array.isArray(flow.events) ? flow.events : [];
    const labels = events.map(activityLabel).filter(Boolean);

    if (labels.length === 0) {
      activitySummary.textContent = "No recent activity";
      activitySite.textContent = "";
      activityPrompt.textContent = "";
      activityTimeline.textContent = "";
      return;
    }

    const summaryEvent =
      Array.from(events).reverse().find((event) => event && event.eventType !== "request_probe_ignored") ||
      events[events.length - 1];
    activitySummary.textContent = activityLabel(summaryEvent).replace(/\s+\(.+\)$/, "");
    activitySite.textContent = flow.displayName || flow.siteId || "";
    activityPrompt.textContent = flow.promptExcerpt ? `"${flow.promptExcerpt}"` : "";
    activityTimeline.textContent = labels.join(" -> ");
  }

  function renderPopupStatus(response) {
    const status = response && (response.popupStatus || response.status);
    renderNotificationHealth(status && status.notificationHealth);
    renderLastCompletion(status && status.lastCompletion);
    renderDiagnostics(status && status.diagnostics);
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

    const supported =
      url &&
      (url.hostname === "chatgpt.com" ||
        url.hostname === "chat.openai.com" ||
        url.hostname === "gemini.google.com");
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
