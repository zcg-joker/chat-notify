(function attachMessages(root, factory) {
  const exports = factory();
  root.ChatNotify = Object.assign({}, root.ChatNotify, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildMessages() {
  const MESSAGE_TYPES = Object.freeze({
    AI_RESPONSE_COMPLETED: "AI_RESPONSE_COMPLETED",
    TEST_NOTIFICATION: "TEST_NOTIFICATION",
    GET_POPUP_STATUS: "GET_POPUP_STATUS",
    SET_ENABLED: "SET_ENABLED",
    LIFECYCLE_EVENT: "CHAT_NOTIFY_LIFECYCLE_EVENT",
    DIAGNOSTIC_EVENT: "DIAGNOSTIC_EVENT",
    START_PAGE_PROBE: "START_PAGE_PROBE",
  });

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createPromptExcerpt(value, limit = 40) {
    const normalized = cleanString(value).replace(/\s+/g, " ");
    const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 40;
    const characters = Array.from(normalized);
    if (characters.length === 0) {
      return "";
    }
    if (characters.length <= safeLimit) {
      return normalized;
    }
    return `${characters.slice(0, safeLimit).join("")}...`;
  }

  function sanitizePath(value) {
    const raw = cleanString(value);
    if (!raw) {
      return "";
    }
    try {
      return new URL(raw, "https://example.invalid").pathname;
    } catch (_error) {
      return raw.split("?")[0].split("#")[0];
    }
  }

  function sanitizeRequestProbe(input = {}) {
    const requestKind = cleanString(input.requestKind).toLowerCase();
    const method = cleanString(input.method).toUpperCase();
    const host = cleanString(input.host).toLowerCase();
    const path = sanitizePath(input.path);
    const reason = cleanString(input.reason);
    if (!requestKind && !method && !host && !path && !reason) {
      return null;
    }
    return {
      requestKind,
      method,
      host,
      path,
      matched: Boolean(input.matched),
      reason,
    };
  }

  function uniqueStrings(values) {
    return Array.from(new Set(values.filter((value) => typeof value === "string" && value)));
  }

  function cloneEventForReport(event = {}) {
    const result = {
      eventType: cleanString(event.eventType || event.type),
      status: event.status === "failed" ? "failed" : "ok",
    };
    const request = sanitizeRequestProbe(event.request || {});
    if (request) {
      result.request = request;
    }
    return result;
  }

  function createProbeReport(input = {}) {
    const status = input.popupStatus || {};
    const diagnostics = status.diagnostics || {};
    const flow = diagnostics.latestFlow || null;
    const events = flow && Array.isArray(flow.events) ? flow.events.map(cloneEventForReport) : [];
    const requestEvents = events.filter((event) => event.request);
    const requestCandidates = Array.isArray(flow && flow.requestCandidates)
      ? flow.requestCandidates.map(sanitizeRequestProbe).filter(Boolean)
      : [];
    const matchedRequests = requestEvents
      .filter((event) => event.request.matched)
      .map((event) => event.request);
    const ignoredRequests = requestEvents
      .filter((event) => !event.request.matched)
      .map((event) => event.request);
    const lifecycleEventTypes = uniqueStrings(
      events
        .map((event) => event.eventType)
        .filter((eventType) => eventType.startsWith("lifecycle_"))
    );
    const notificationEventTypes = uniqueStrings(
      events
        .map((event) => event.eventType)
        .filter((eventType) => eventType.startsWith("notification_"))
    );
    const currentPage = input.currentPage || {};
    const settings = input.settings || {};
    const report = {
      schemaVersion: 1,
      generatedAt: Number.isFinite(input.generatedAt) ? input.generatedAt : Date.now(),
      currentPage: {
        supported: Boolean(currentPage.supported),
        host: cleanString(currentPage.host).toLowerCase(),
      },
      settings: {
        enabled: Boolean(settings.enabled),
        debugLogs: Boolean(settings.debugLogs),
      },
      latestFlow: null,
    };

    if (flow) {
      report.latestFlow = {
        flowId: cleanString(flow.flowId),
        siteId: cleanString(flow.siteId),
        displayName: cleanString(flow.displayName),
        promptExcerpt: createPromptExcerpt(flow.promptExcerpt || ""),
        updatedAt: Number.isFinite(flow.updatedAt) ? flow.updatedAt : null,
        summary: {
          totalEvents: events.length,
          requestProbeCount: requestEvents.length,
          matchedRequestCount: matchedRequests.length,
          ignoredRequestCount: ignoredRequests.length,
          requestCandidateCount: requestCandidates.length,
          lifecycleEventTypes,
          notificationEventTypes,
        },
        requestCandidates,
        matchedRequests,
        ignoredRequests,
        events,
      };
    }

    return report;
  }

  function createResponseCompletedMessage(input = {}) {
    return {
      type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
      payload: {
        flowId: cleanString(input.flowId),
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        sessionKey: cleanString(input.sessionKey),
        sourceTabId: Number.isFinite(input.sourceTabId) ? input.sourceTabId : null,
        promptExcerpt: cleanString(input.promptExcerpt),
        completedAt: Number.isFinite(input.completedAt) ? input.completedAt : Date.now(),
      },
    };
  }

  function createDiagnosticEventMessage(input = {}) {
    const payload = {
      type: MESSAGE_TYPES.DIAGNOSTIC_EVENT,
      payload: {
        flowId: cleanString(input.flowId),
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        promptExcerpt: createPromptExcerpt(input.promptExcerpt || ""),
        eventType: cleanString(input.eventType),
        status: input.status === "failed" ? "failed" : "ok",
        message: typeof input.message === "string" ? input.message.split("\n")[0].trim() : "",
      },
    };
    const request = sanitizeRequestProbe(input.request || input);
    if (request) {
      payload.payload.request = request;
    }
    return payload;
  }

  function createTestNotificationMessage() {
    return {
      type: MESSAGE_TYPES.TEST_NOTIFICATION,
      payload: {},
    };
  }

  function createStartPageProbeMessage(input = {}) {
    return {
      type: MESSAGE_TYPES.START_PAGE_PROBE,
      payload: {
        tabId: Number.isFinite(input.tabId) ? input.tabId : null,
        host: cleanString(input.host).toLowerCase(),
      },
    };
  }

  return {
    MESSAGE_TYPES,
    createDiagnosticEventMessage,
    createProbeReport,
    createResponseCompletedMessage,
    createStartPageProbeMessage,
    createTestNotificationMessage,
  };
});
