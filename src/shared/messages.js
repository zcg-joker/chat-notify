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

  function addCandidateSignal(signals, signal) {
    if (!signals.includes(signal)) {
      signals.push(signal);
    }
  }

  function scoreGenerationCandidate(request) {
    const path = cleanString(request.path).toLowerCase();
    const method = cleanString(request.method).toUpperCase();
    const requestKind = cleanString(request.requestKind).toLowerCase();
    const signals = [];
    let score = 0;

    if (requestKind === "eventsource" || requestKind === "websocket") {
      score += 60;
      addCandidateSignal(signals, "streaming_transport");
    }

    const isPost = method === "POST";
    if (isPost) {
      score += 30;
      addCandidateSignal(signals, "post_method");
    }

    if (/generate|completion|message|response|answer|\/conversation(?:\/|$)|\/chat(?:\/|$)/.test(path)) {
      score += 40;
      addCandidateSignal(signals, "generation_path");
    }
    if (/stream|sse|events/.test(path)) {
      score += 10;
      addCandidateSignal(signals, "stream_path");
    }
    if (/chat|assistant|bard/.test(path)) {
      score += 10;
      addCandidateSignal(signals, "chat_path");
    }
    if (/telemetry|analytics|stats|beacon|sentinel|log|metrics|ces\//.test(path)) {
      score -= 80;
      addCandidateSignal(signals, "telemetry_path");
    }
    if (/prepare|warmup|bootstrap|init/.test(path)) {
      score -= 50;
      addCandidateSignal(signals, "prepare_path");
    }
    if (/conversation[s]?$|history|list|metadata|profile|settings/.test(path)) {
      score += 20;
      addCandidateSignal(signals, "metadata_path");
    }
    if (!isPost) {
      score -= 10;
      addCandidateSignal(signals, "non_post_method");
    }

    return Object.assign({}, request, {
      score: Math.max(0, score),
      signals,
    });
  }

  function rankLikelyGenerationCandidates(requestCandidates) {
    return requestCandidates
      .map(scoreGenerationCandidate)
      .filter((candidate) => candidate.score > 0 && candidate.signals.length > 1)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, 5);
  }

  function createSuggestionId(host) {
    const firstLabel = cleanString(host).toLowerCase().split(".").find(Boolean) || "site";
    return firstLabel.replace(/[^a-z0-9_-]/g, "") || "site";
  }

  function createDisplayNameSuggestion(siteId) {
    if (!siteId) {
      return "AI Site";
    }
    return `${siteId.charAt(0).toUpperCase()}${siteId.slice(1)}`;
  }

  function createAdapterDraft(currentPage, likelyGenerationCandidates) {
    if (!likelyGenerationCandidates.length) {
      return null;
    }
    const host = cleanString(currentPage.host).toLowerCase();
    if (!host) {
      return null;
    }
    const siteIdSuggestion = createSuggestionId(host);
    const topCandidate = likelyGenerationCandidates[0];
    const matchers = likelyGenerationCandidates
      .filter((candidate) => candidate.score >= 50)
      .map((candidate) => ({ pathname: candidate.path }))
      .slice(0, 3);
    return {
      host,
      siteIdSuggestion,
      displayNameSuggestion: createDisplayNameSuggestion(siteIdSuggestion),
      confidence: topCandidate.score >= 90 ? "medium" : "low",
      promptExtractorSuggestion: "none",
      lifecycleBridgeConfigSuggestion: {
        hosts: [host],
        generationRequestMatchers: matchers.length ? matchers : [{ pathname: topCandidate.path }],
      },
      rationale: [
        `Top candidate ${topCandidate.path} scored ${topCandidate.score} from ${topCandidate.signals.join(", ")}.`,
        "Candidate paths are same-host and sanitized; query strings, bodies, and headers are omitted.",
      ],
      manualChecks: [
        "Confirm the top matcher stays open until the visible AI response is complete.",
        "Confirm prompt extraction can use visible editor text or implement a safe request-body extractor.",
        "Confirm send detection, session key extraction, cancellation, and same-tab session switching.",
      ],
    };
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
    const likelyGenerationCandidates = rankLikelyGenerationCandidates(requestCandidates);
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
      const adapterDraft = createAdapterDraft(report.currentPage, likelyGenerationCandidates);
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
          likelyGenerationCandidateCount: likelyGenerationCandidates.length,
          lifecycleEventTypes,
          notificationEventTypes,
        },
        requestCandidates,
        likelyGenerationCandidates,
        adapterDraft,
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
