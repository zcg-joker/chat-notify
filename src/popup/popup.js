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
  const probeReadiness = document.getElementById("probe-readiness");
  const probeTopCandidate = document.getElementById("probe-top-candidate");
  const probeRisk = document.getElementById("probe-risk");
  const copyDiagnosticsButton = document.getElementById("copy-diagnostics");
  const copyDiagnosticsStatus = document.getElementById("copy-diagnostics-status");
  const probeScenarioSelect = document.getElementById("probe-scenario");
  const startPageProbeButton = document.getElementById("start-page-probe");
  const startPageProbeStatus = document.getElementById("start-page-probe-status");
  let latestPopupStatus = null;
  let latestPageInfo = { supported: false, host: "", tabId: null };
  let latestSettings = { enabled: true, debugLogs: false };

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

  function titleCaseStatus(value) {
    const words = String(value || "")
      .split("_")
      .filter(Boolean);
    if (!words.length) {
      return "";
    }
    return [`${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}`, ...words.slice(1)].join(" ");
  }

  function clearProbePreview() {
    probeReadiness.textContent = "";
    probeTopCandidate.textContent = "";
    probeRisk.textContent = "";
  }

  function formatCandidate(candidate) {
    return [
      candidate && candidate.method,
      `${(candidate && candidate.host) || ""}${(candidate && candidate.path) || ""}`,
      "via",
      candidate && candidate.requestKind,
    ].filter(Boolean).join(" ");
  }

  function formatScenarioCoverage(comparison) {
    const scenarioCoverage = comparison && Array.isArray(comparison.scenarioCoverage)
      ? comparison.scenarioCoverage
      : [];
    const coveredScenarios = scenarioCoverage
      .filter((entry) => entry && entry.sampleCount > 0 && entry.scenario)
      .map((entry) => entry.scenario);
    return coveredScenarios.length ? `Covered: ${coveredScenarios.join(", ")}` : "";
  }

  function formatSampleCoverage(comparison) {
    if (!comparison || !Number.isFinite(comparison.sampleCount)) {
      return "";
    }
    return [`Samples: ${comparison.sampleCount}`, formatScenarioCoverage(comparison)].filter(Boolean).join("; ");
  }

  function formatChecklistBlocker(checklist) {
    const items = Array.isArray(checklist) ? checklist : [];
    const blocker =
      items.find((item) => item && item.status === "needs_more_evidence" && Array.isArray(item.missing) && item.missing.length) ||
      items.find((item) => item && item.status === "needs_more_evidence");
    if (!blocker) {
      return "";
    }
    const itemName = blocker.item || "adapter_check";
    if (Array.isArray(blocker.missing) && blocker.missing.length) {
      return `Blocked: ${itemName} needs ${blocker.missing.join(", ")}`;
    }
    return blocker.nextStep ? `Blocked: ${itemName}: ${blocker.nextStep}` : `Blocked: ${itemName}`;
  }

  function renderProbePreview(diagnostics) {
    const recommendation = diagnostics && diagnostics.recommendation;
    if (recommendation && recommendation.status) {
      probeReadiness.textContent = titleCaseStatus(recommendation.status);
      const sampleCoverage = formatSampleCoverage(diagnostics && diagnostics.probeComparison);
      const candidate = recommendation.primaryCandidate;
      if (candidate) {
        const stability = candidate.stability ? `, ${candidate.stability}` : "";
        const candidateText = `Candidate: ${formatCandidate(candidate)} (score ${
          candidate.score || 0
        }${stability})`;
        probeTopCandidate.textContent = [candidateText, sampleCoverage].filter(Boolean).join("; ");
      } else {
        probeTopCandidate.textContent = [recommendation.summary || "", sampleCoverage].filter(Boolean).join("; ");
      }
      const nextActions = Array.isArray(recommendation.nextActions) ? recommendation.nextActions : [];
      const missingScenarios = Array.isArray(recommendation.missingScenarios)
        ? recommendation.missingScenarios
        : [];
      const checklistBlocker = formatChecklistBlocker(diagnostics && diagnostics.adapterChecklist);
      probeRisk.textContent = [
        checklistBlocker,
        nextActions.length ? `Next: ${nextActions[0]}` : "",
        missingScenarios.length ? `Missing: ${missingScenarios.join(", ")}` : "",
      ].filter(Boolean).slice(0, 1).join(" ");
      return;
    }

    const comparison = diagnostics && diagnostics.probeComparison;
    const stableCandidates = comparison && Array.isArray(comparison.stableCandidates)
      ? comparison.stableCandidates
      : [];
    if (stableCandidates.length) {
      const stableCandidate = stableCandidates[0];
      probeReadiness.textContent = "Stable candidate";
      probeTopCandidate.textContent = `Stable: ${formatCandidate(stableCandidate)} (score ${
        stableCandidate.score || 0
      }, ${stableCandidate.stability || "stable"})`;
      probeRisk.textContent = [
        Number.isFinite(comparison.sampleCount) ? `Samples: ${comparison.sampleCount}` : "",
        formatScenarioCoverage(comparison),
      ].filter(Boolean).join("; ");
      return;
    }

    const flow = diagnostics && diagnostics.latestFlow;
    const analysis = flow && flow.analysis;
    if (!analysis) {
      clearProbePreview();
      return;
    }

    probeReadiness.textContent = titleCaseStatus(analysis.readiness);
    const topCandidate = analysis.topCandidate;
    if (topCandidate) {
      probeTopCandidate.textContent = `Top: ${formatCandidate(topCandidate)} (score ${topCandidate.score || 0})`;
    } else {
      probeTopCandidate.textContent = "";
    }
    const riskSignals = Array.isArray(analysis.riskSignals) ? analysis.riskSignals : [];
    probeRisk.textContent = riskSignals.length ? `Risk: ${riskSignals[0]}` : "";
  }

  function renderDiagnostics(diagnostics) {
    const flow = diagnostics && diagnostics.latestFlow;
    const events = flow && Array.isArray(flow.events) ? flow.events : [];
    const visibleEvents = events.some((event) => event && event.eventType !== "request_probe_ignored")
      ? events.filter((event) => event && event.eventType !== "request_probe_ignored")
      : events;
    const labels = visibleEvents.map(activityLabel).filter(Boolean);

    if (labels.length === 0) {
      activitySummary.textContent = "No recent activity";
      activitySite.textContent = "";
      activityPrompt.textContent = "";
      activityTimeline.textContent = "";
      renderProbePreview(diagnostics);
      return;
    }

    const summaryEvent =
      Array.from(visibleEvents).reverse().find((event) => event && event.eventType !== "request_probe_ignored") ||
      visibleEvents[visibleEvents.length - 1];
    activitySummary.textContent = activityLabel(summaryEvent).replace(/\s+\(.+\)$/, "");
    activitySite.textContent = flow.displayName || flow.siteId || "";
    activityPrompt.textContent = flow.promptExcerpt ? `"${flow.promptExcerpt}"` : "";
    activityTimeline.textContent = labels.join(" -> ");
    renderProbePreview(diagnostics);
  }

  function renderPopupStatus(response) {
    const status = response && (response.popupStatus || response.status);
    latestPopupStatus = status || null;
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
    latestSettings = {
      enabled: enabledToggle.checked,
      debugLogs: debugLogsToggle.checked,
    };
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
    latestPageInfo = {
      supported: Boolean(supported),
      host: url && url.hostname ? url.hostname : "",
      tabId: tabs[0] && Number.isFinite(tabs[0].id) ? tabs[0].id : null,
    };
    siteStatus.textContent = supported ? "Current page is supported" : "Current page is not supported";
    startPageProbeButton.disabled = !url || Boolean(supported);
  });

  enabledToggle.addEventListener("change", () => {
    renderExtensionStatus();
    latestSettings.enabled = enabledToggle.checked;
    chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  debugLogsToggle.addEventListener("change", () => {
    latestSettings.debugLogs = debugLogsToggle.checked;
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

  startPageProbeButton.addEventListener("click", () => {
    const message = ChatNotify.createStartPageProbeMessage({
      tabId: latestPageInfo.tabId,
      host: latestPageInfo.host,
      scenario: probeScenarioSelect.value,
    });
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        startPageProbeStatus.textContent = shortError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.ok) {
        startPageProbeStatus.textContent = `Probe started for ${response.host || latestPageInfo.host}`;
        return;
      }
      startPageProbeStatus.textContent = shortError((response && response.error) || "Probe failed");
    });
  });

  copyDiagnosticsButton.addEventListener("click", () => {
    const report = ChatNotify.createProbeReport({
      generatedAt: Date.now(),
      currentPage: latestPageInfo,
      settings: latestSettings,
      popupStatus: latestPopupStatus,
    });
    const text = JSON.stringify(report, null, 2);
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      copyDiagnosticsStatus.textContent = "Copy failed";
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        copyDiagnosticsStatus.textContent = "Diagnostics copied";
      },
      () => {
        copyDiagnosticsStatus.textContent = "Copy failed";
      }
    );
  });
})();
