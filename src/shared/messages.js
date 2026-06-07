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

  const PROBE_SCENARIOS = Object.freeze([
    "unspecified",
    "short_response",
    "long_response",
    "tab_switch",
    "same_tab_session_switch",
    "canceled_generation",
    "failed_generation",
  ]);
  const REQUIRED_RECOMMENDATION_SCENARIOS = Object.freeze(["short_response", "long_response"]);
  const COVERAGE_SCENARIOS = Object.freeze(PROBE_SCENARIOS.filter((scenario) => scenario !== "unspecified"));

  function sanitizeProbeScenario(value) {
    const scenario = cleanString(value).toLowerCase();
    return PROBE_SCENARIOS.includes(scenario) ? scenario : "unspecified";
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

  function requestCandidateKey(request) {
    return [
      request.requestKind,
      request.method,
      request.host,
      request.path,
      request.matched ? "matched" : "ignored",
      request.reason,
    ].join("\u0000");
  }

  function createScenarioCoverage(samples) {
    const coverageByScenario = new Map(
      COVERAGE_SCENARIOS.map((scenario) => [scenario, { scenario, sampleCount: 0, latestUpdatedAt: null }])
    );
    samples.forEach((sample) => {
      const coverage = coverageByScenario.get(sample.scenario);
      if (!coverage) {
        return;
      }
      coverage.sampleCount += 1;
      if (Number.isFinite(sample.updatedAt)) {
        coverage.latestUpdatedAt = Math.max(coverage.latestUpdatedAt || 0, sample.updatedAt);
      }
    });
    return COVERAGE_SCENARIOS.map((scenario) => coverageByScenario.get(scenario));
  }

  function createProbeComparison(samples) {
    const sanitizedSamples = Array.isArray(samples)
      ? samples
          .map((sample) => ({
            flowId: cleanString(sample && sample.flowId),
            scenario: sanitizeProbeScenario(sample && sample.scenario),
            updatedAt: Number.isFinite(sample && sample.updatedAt) ? sample.updatedAt : null,
            requestCandidates: Array.isArray(sample && sample.requestCandidates)
              ? sample.requestCandidates.map(sanitizeRequestProbe).filter(Boolean)
              : [],
          }))
          .filter((sample) => sample.flowId)
      : [];
    const sampleCount = sanitizedSamples.length;
    if (!sampleCount) {
      return {
        sampleCount: 0,
        stableCandidates: [],
        stableIgnoredCandidates: [],
        sampleSummaries: [],
        scenarioCoverage: createScenarioCoverage(sanitizedSamples),
      };
    }

    const candidateByKey = new Map();
    sanitizedSamples.forEach((sample) => {
      const keysInSample = new Set();
      sample.requestCandidates.forEach((candidate) => {
        const key = requestCandidateKey(candidate);
        if (keysInSample.has(key)) {
          return;
        }
        keysInSample.add(key);
        const existing = candidateByKey.get(key) || { candidate, sampleCount: 0, scenarios: [] };
        existing.sampleCount += 1;
        if (!existing.scenarios.includes(sample.scenario)) {
          existing.scenarios.push(sample.scenario);
        }
        candidateByKey.set(key, existing);
      });
    });

    const stableCandidates = Array.from(candidateByKey.values())
      .filter((entry) => entry.sampleCount >= 2 && entry.candidate.matched)
      .map((entry) => {
        const scored = scoreGenerationCandidate(entry.candidate);
        return Object.assign({}, scored, {
          sampleCount: entry.sampleCount,
          stability: `${entry.sampleCount}/${sampleCount}`,
          scenarios: entry.scenarios,
        });
      })
      .sort((left, right) => {
        if (right.sampleCount !== left.sampleCount) {
          return right.sampleCount - left.sampleCount;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, 5);
    const stableIgnoredCandidates = Array.from(candidateByKey.values())
      .filter((entry) => entry.sampleCount >= 2 && !entry.candidate.matched)
      .map((entry) => {
        const scored = scoreGenerationCandidate(entry.candidate);
        return Object.assign({}, scored, {
          sampleCount: entry.sampleCount,
          stability: `${entry.sampleCount}/${sampleCount}`,
          scenarios: entry.scenarios,
        });
      })
      .sort((left, right) => {
        if (right.sampleCount !== left.sampleCount) {
          return right.sampleCount - left.sampleCount;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, 5);

    return {
      sampleCount,
      stableCandidates,
      stableIgnoredCandidates,
      sampleSummaries: sanitizedSamples.map((sample) => ({
        flowId: sample.flowId,
        scenario: sample.scenario,
        candidateCount: sample.requestCandidates.length,
        updatedAt: sample.updatedAt,
      })),
      scenarioCoverage: createScenarioCoverage(sanitizedSamples),
    };
  }

  function createRecommendationCandidate(candidate) {
    if (!candidate) {
      return null;
    }
    return {
      requestKind: candidate.requestKind,
      method: candidate.method,
      host: candidate.host,
      path: candidate.path,
      score: candidate.score,
      stability: candidate.stability,
      scenarios: Array.isArray(candidate.scenarios) ? candidate.scenarios.slice() : [],
    };
  }

  function createProbeRecommendation(probeComparison) {
    const stableCandidates = probeComparison && Array.isArray(probeComparison.stableCandidates)
      ? probeComparison.stableCandidates
      : [];
    const primaryCandidate = stableCandidates[0] || null;
    if (!primaryCandidate) {
      return {
        status: "insufficient_evidence",
        summary: "Collect at least two page-probe samples before choosing an adapter matcher.",
        missingScenarios: REQUIRED_RECOMMENDATION_SCENARIOS.slice(),
        primaryCandidate: null,
        nextActions: [
          "Run page probe for a short response.",
          "Run page probe for a long response.",
        ],
      };
    }

    const candidateScenarios = Array.isArray(primaryCandidate.scenarios) ? primaryCandidate.scenarios : [];
    const missingScenarios = REQUIRED_RECOMMENDATION_SCENARIOS.filter(
      (scenario) => !candidateScenarios.includes(scenario)
    );
    if (missingScenarios.length) {
      return {
        status: "collect_more_samples",
        summary: "Stable candidate found, but key probe scenarios are still missing.",
        missingScenarios,
        primaryCandidate: createRecommendationCandidate(primaryCandidate),
        nextActions: [
          ...missingScenarios.map((scenario) =>
            scenario === "short_response"
              ? "Run page probe for a short response."
              : "Run page probe for a long response."
          ),
          "Confirm the stable candidate appears in the missing scenarios.",
        ],
      };
    }

    return {
      status: "ready_for_adapter_draft",
      summary: "Stable generation candidate covers short and long response samples.",
      missingScenarios: [],
      primaryCandidate: createRecommendationCandidate(primaryCandidate),
      nextActions: [
        "Confirm the candidate stays active until visible completion.",
        "Use the stable candidate as the first adapter matcher draft.",
      ],
    };
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

  function createImplementationNotes(host, generationRequestMatchers, excludedRequestCandidates) {
    return {
      lifecycle: {
        hosts: [host],
        generationRequestMatchers: generationRequestMatchers.map((matcher) => ({ pathname: matcher.pathname })),
        excludedPathnames: uniqueStrings(excludedRequestCandidates.map((candidate) => candidate.path)),
        completionCheck: "Confirm the matcher stays active until the visible AI response is complete.",
      },
      promptExtraction: {
        currentProbeSupport: "none",
        nextStep: "Use visible editor text first, or add a safe request-body excerpt extractor.",
      },
      sendDetection: {
        nextStep: "Confirm the page exposes a reliable button, keyboard, or editor-submit signal.",
      },
      sessionKey: {
        nextStep: "Extract a stable conversation id when available, otherwise use a temporary per-tab key.",
      },
      edgeCases: [
        "Confirm cancellation and failed generation do not send completion notifications.",
        "Confirm same-tab session switching keeps lifecycle events bound to the correct prompt.",
      ],
    };
  }

  function createStableAdapterDraft(currentPage, probeComparison) {
    const stableCandidates = probeComparison && Array.isArray(probeComparison.stableCandidates)
      ? probeComparison.stableCandidates
      : [];
    if (!stableCandidates.length) {
      return null;
    }
    const host = cleanString(currentPage.host).toLowerCase();
    if (!host) {
      return null;
    }
    const topCandidate = stableCandidates[0];
    const matchers = stableCandidates
      .filter((candidate) => candidate.score >= 50)
      .map((candidate) => ({ pathname: candidate.path }))
      .slice(0, 3);
    const generationRequestMatchers = matchers.length ? matchers : [{ pathname: topCandidate.path }];
    const excludedRequestCandidates = Array.isArray(probeComparison.stableIgnoredCandidates)
      ? probeComparison.stableIgnoredCandidates.map((candidate) => ({
          requestKind: candidate.requestKind,
          method: candidate.method,
          host: candidate.host,
          path: candidate.path,
          reason: candidate.reason,
          stability: candidate.stability,
          scenarios: Array.isArray(candidate.scenarios) ? candidate.scenarios.slice() : [],
        })).slice(0, 5)
      : [];
    const scenarios = Array.isArray(topCandidate.scenarios) ? topCandidate.scenarios : [];
    const siteIdSuggestion = createSuggestionId(host);
    return {
      host,
      siteIdSuggestion,
      displayNameSuggestion: createDisplayNameSuggestion(siteIdSuggestion),
      confidence: topCandidate.score >= 90 ? "medium" : "low",
      promptExtractorSuggestion: "none",
      lifecycleBridgeConfigSuggestion: {
        hosts: [host],
        generationRequestMatchers,
      },
      excludedRequestCandidates,
      implementationNotes: createImplementationNotes(host, generationRequestMatchers, excludedRequestCandidates),
      source: "probeComparison.stableCandidates",
      rationale: [
        `Stable candidate ${topCandidate.path} appeared in ${
          topCandidate.stability || `${topCandidate.sampleCount || 0}/${probeComparison.sampleCount || 0}`
        } retained probe samples.`,
        scenarios.length ? `Covered scenarios: ${scenarios.join(", ")}.` : "No named probe scenarios were retained.",
        "Candidate paths are same-host and sanitized; query strings, bodies, and headers are omitted.",
      ],
      manualChecks: [
        "Confirm the top matcher stays open until the visible AI response is complete.",
        "Confirm prompt extraction can use visible editor text or implement a safe request-body extractor.",
        "Confirm send detection, session key extraction, cancellation, and same-tab session switching.",
      ],
    };
  }

  function createCandidateSummary(candidate, index) {
    return `${index + 1}. ${candidate.method || "GET"} ${candidate.path || "/"} via ${
      candidate.requestKind || "request"
    } scored ${candidate.score} (${candidate.signals.join(", ")}).`;
  }

  function createAdapterAnalysis(likelyGenerationCandidates, requestCandidates) {
    if (!likelyGenerationCandidates.length) {
      return {
        readiness: "insufficient_evidence",
        topCandidate: null,
        candidateSummary: [],
        riskSignals: [
          "No likely generation candidates were found; collect another probe report after sending a short prompt.",
        ],
        nextChecks: [
          "Confirm the page probe was started before sending the prompt.",
          "Enable debug logs only if console-level bridge details are needed.",
        ],
      };
    }

    const topCandidate = likelyGenerationCandidates[0];
    const candidateSummary = likelyGenerationCandidates.slice(0, 3).map(createCandidateSummary);
    const allSignals = new Set(likelyGenerationCandidates.flatMap((candidate) => candidate.signals));
    const riskSignals = [];
    if (allSignals.has("streaming_transport")) {
      riskSignals.push(
        "Top candidate uses a streaming transport; URL matching is visible, but message contents are not inspected by probe mode."
      );
    }
    if (
      requestCandidates.some((candidate) =>
        (candidate.path || "").toLowerCase().match(/prepare|warmup|bootstrap|init/)
      )
    ) {
      riskSignals.push(
        "Prepare/warmup candidates were observed; keep them out of generation matchers unless completion evidence proves otherwise."
      );
    }
    if (allSignals.has("metadata_path")) {
      riskSignals.push(
        "Metadata or conversation-list candidates were observed; avoid using them as completion signals."
      );
    }
    if (!riskSignals.length) {
      riskSignals.push("No obvious noise signals were found in the strongest candidates.");
    }

    return {
      readiness: "needs_manual_verification",
      topCandidate: {
        requestKind: topCandidate.requestKind,
        method: topCandidate.method,
        host: topCandidate.host,
        path: topCandidate.path,
        score: topCandidate.score,
        signals: topCandidate.signals,
      },
      candidateSummary,
      riskSignals,
      nextChecks: [
        "Verify whether the top candidate stays active until the visible answer is complete.",
        "Send a longer prompt and confirm the same candidate remains the strongest signal.",
        "Switch away from the tab during generation and confirm the candidate is still observed.",
        "Check cancellation/failure behavior before sending completion notifications.",
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
    const probeComparison = createProbeComparison(diagnostics.probeSamples);
    const recommendation = createProbeRecommendation(probeComparison);
    const adapterDraft = recommendation.status === "ready_for_adapter_draft"
      ? createStableAdapterDraft(currentPage, probeComparison)
      : null;
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
      probeComparison,
      recommendation,
      adapterDraft,
      latestFlow: null,
    };

    if (flow) {
      const adapterDraft = createAdapterDraft(report.currentPage, likelyGenerationCandidates);
      const analysis = createAdapterAnalysis(likelyGenerationCandidates, requestCandidates);
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
        analysis,
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
    if (typeof input.scenario === "string") {
      payload.payload.scenario = sanitizeProbeScenario(input.scenario);
    }
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
        scenario: sanitizeProbeScenario(input.scenario),
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
