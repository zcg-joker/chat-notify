const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
  createDiagnosticEventMessage,
  createProbeReport,
  createResponseCompletedMessage,
  createStartPageProbeMessage,
  createTestNotificationMessage,
} = require("../src/shared/messages.js");

test("createResponseCompletedMessage creates a sanitized completion event", () => {
  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:abc",
    sourceTabId: 12,
    promptExcerpt: "Summarize this paper...",
    completedAt: 1780761600000,
  });

  assert.deepEqual(message, {
    type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
    payload: {
      flowId: "",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:abc",
      sourceTabId: 12,
      promptExcerpt: "Summarize this paper...",
      completedAt: 1780761600000,
    },
  });
});

test("createResponseCompletedMessage trims prompt excerpts and does not add chat content fields", () => {
  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:abc",
    sourceTabId: 12,
    promptExcerpt: "  hello  ",
    completedAt: 1780761600000,
    assistantText: "must not be forwarded",
  });

  assert.equal(message.payload.promptExcerpt, "hello");
  assert.equal(Object.hasOwn(message.payload, "assistantText"), false);
});

test("createResponseCompletedMessage carries flow ids", () => {
  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:abc",
    flowId: "chatgpt:1780761600000:1",
    promptExcerpt: "hello",
  });

  assert.equal(message.payload.flowId, "chatgpt:1780761600000:1");
});

test("createDiagnosticEventMessage sanitizes diagnostic payload", () => {
  const message = createDiagnosticEventMessage({
    flowId: " chatgpt:1780761600000:1 ",
    siteId: " chatgpt ",
    displayName: " ChatGPT ",
    promptExcerpt: "  hello\n\nworld\tfrom   chatgpt with a long prompt that should stop  ",
    eventType: " lifecycle_failed ",
    status: "failed",
    message: " first line only \nsecond line includes secret",
    sessionKey: "conversation:secret",
    url: "https://chatgpt.com/c/secret",
    requestBody: "secret",
    responseBody: "secret",
    headers: { authorization: "Bearer token" },
    assistantText: "private answer",
  });

  assert.deepEqual(message, {
    type: MESSAGE_TYPES.DIAGNOSTIC_EVENT,
    payload: {
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "hello world from chatgpt with a long pro...",
      eventType: "lifecycle_failed",
      status: "failed",
      message: "first line only",
    },
  });
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes("conversation:secret"), false);
  assert.equal(serialized.includes("https://chatgpt.com"), false);
  assert.equal(serialized.includes("Bearer token"), false);
  assert.equal(serialized.includes("private answer"), false);
});

test("createDiagnosticEventMessage keeps sanitized request probe metadata only", () => {
  const message = createDiagnosticEventMessage({
    flowId: "gemini:1780761600000:1",
    siteId: "gemini",
    displayName: "Gemini",
    eventType: "request_probe_matched",
    requestKind: "xhr",
    method: " post ",
    host: " gemini.google.com ",
    path: " /_/BardChatUi/data/batchexecute?rpcids=secret ",
    matched: true,
    reason: " matched_generation_request ",
    url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=secret",
    body: "prompt and token",
    headers: { authorization: "Bearer token" },
  });

  assert.deepEqual(message, {
    type: MESSAGE_TYPES.DIAGNOSTIC_EVENT,
    payload: {
      flowId: "gemini:1780761600000:1",
      siteId: "gemini",
      displayName: "Gemini",
      promptExcerpt: "",
      eventType: "request_probe_matched",
      status: "ok",
      message: "",
      request: {
        requestKind: "xhr",
        method: "POST",
        host: "gemini.google.com",
        path: "/_/BardChatUi/data/batchexecute",
        matched: true,
        reason: "matched_generation_request",
      },
    },
  });
  const serialized = JSON.stringify(message);
  assert.equal(serialized.includes("rpcids=secret"), false);
  assert.equal(serialized.includes("prompt and token"), false);
  assert.equal(serialized.includes("Bearer token"), false);
});

test("createProbeReport builds a sanitized adapter-focused report", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: true,
      url: "https://chatgpt.com/c/secret-conversation?token=secret",
      host: "chatgpt.com",
    },
    settings: {
      enabled: true,
      debugLogs: true,
    },
    popupStatus: {
      diagnostics: {
        latestFlow: {
          flowId: "chatgpt:1780761600000:1",
          siteId: "chatgpt",
          displayName: "ChatGPT",
          promptExcerpt: "summarize this paper with private details",
          updatedAt: 1780761602000,
          requestCandidates: [
            {
              requestKind: "xhr",
              method: "POST",
              host: "chatgpt.com",
              path: "/backend-api/extra-candidate?token=secret",
              matched: true,
              reason: "probe_observed_request",
              body: "must not leak",
            },
          ],
          events: [
            {
              eventType: "request_probe_ignored",
              request: {
                requestKind: "fetch",
                method: "POST",
                host: "chatgpt.com",
                path: "/backend-api/f/conversation/prepare?token=secret",
                matched: false,
                reason: "path_not_matched",
              },
            },
            {
              eventType: "request_probe_matched",
              request: {
                requestKind: "fetch",
                method: "POST",
                host: "chatgpt.com",
                path: "/backend-api/f/conversation?token=secret",
                matched: true,
                reason: "matched_generation_request",
              },
            },
            {
              eventType: "lifecycle_completed",
              message: "body secret",
              requestBody: "must not leak",
              headers: { authorization: "Bearer token" },
            },
            { eventType: "notification_sent" },
          ],
        },
      },
    },
  });

  assert.deepEqual(report, {
    schemaVersion: 1,
    generatedAt: 1780761600000,
    currentPage: {
      supported: true,
      host: "chatgpt.com",
    },
    settings: {
      enabled: true,
      debugLogs: true,
    },
    probeComparison: {
      sampleCount: 0,
      stableCandidates: [],
      stableIgnoredCandidates: [],
      sampleSummaries: [],
      scenarioCoverage: [
        { scenario: "short_response", sampleCount: 0, latestUpdatedAt: null },
        { scenario: "long_response", sampleCount: 0, latestUpdatedAt: null },
        { scenario: "tab_switch", sampleCount: 0, latestUpdatedAt: null },
        { scenario: "same_tab_session_switch", sampleCount: 0, latestUpdatedAt: null },
        { scenario: "canceled_generation", sampleCount: 0, latestUpdatedAt: null },
        { scenario: "failed_generation", sampleCount: 0, latestUpdatedAt: null },
      ],
    },
    recommendation: {
      status: "insufficient_evidence",
      summary: "Collect at least two page-probe samples before choosing an adapter matcher.",
      missingScenarios: ["short_response", "long_response"],
      primaryCandidate: null,
      nextActions: [
        "Run page probe for a short response.",
        "Run page probe for a long response.",
      ],
    },
    adapterDraft: null,
    latestFlow: {
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "summarize this paper with private detail...",
      updatedAt: 1780761602000,
      summary: {
        totalEvents: 4,
        requestProbeCount: 2,
        matchedRequestCount: 1,
        ignoredRequestCount: 1,
        requestCandidateCount: 1,
        likelyGenerationCandidateCount: 0,
        lifecycleEventTypes: ["lifecycle_completed"],
        notificationEventTypes: ["notification_sent"],
      },
      requestCandidates: [
        {
          requestKind: "xhr",
          method: "POST",
          host: "chatgpt.com",
          path: "/backend-api/extra-candidate",
          matched: true,
          reason: "probe_observed_request",
        },
      ],
      likelyGenerationCandidates: [],
      adapterDraft: null,
      analysis: {
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
      },
      matchedRequests: [
        {
          requestKind: "fetch",
          method: "POST",
          host: "chatgpt.com",
          path: "/backend-api/f/conversation",
          matched: true,
          reason: "matched_generation_request",
        },
      ],
      ignoredRequests: [
        {
          requestKind: "fetch",
          method: "POST",
          host: "chatgpt.com",
          path: "/backend-api/f/conversation/prepare",
          matched: false,
          reason: "path_not_matched",
        },
      ],
      events: [
        {
          eventType: "request_probe_ignored",
          status: "ok",
          request: {
            requestKind: "fetch",
            method: "POST",
            host: "chatgpt.com",
            path: "/backend-api/f/conversation/prepare",
            matched: false,
            reason: "path_not_matched",
          },
        },
        {
          eventType: "request_probe_matched",
          status: "ok",
          request: {
            requestKind: "fetch",
            method: "POST",
            host: "chatgpt.com",
            path: "/backend-api/f/conversation",
            matched: true,
            reason: "matched_generation_request",
          },
        },
        { eventType: "lifecycle_completed", status: "ok" },
        { eventType: "notification_sent", status: "ok" },
      ],
    },
  });

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("secret-conversation"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("must not leak"), false);
  assert.equal(serialized.includes("Bearer token"), false);
});

test("createProbeReport ranks likely generation candidates for adapter design", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: false,
      host: "example.com",
    },
    settings: {
      enabled: true,
      debugLogs: false,
    },
    popupStatus: {
      diagnostics: {
        latestFlow: {
          flowId: "probe:example.com:1780761600000",
          siteId: "page-probe",
          displayName: "Page Probe",
          updatedAt: 1780761602000,
          requestCandidates: [
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/telemetry/intake?token=secret",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "xhr",
              method: "POST",
              host: "example.com",
              path: "/api/chat/stream?conversation=secret",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "fetch",
              method: "GET",
              host: "example.com",
              path: "/api/conversations",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/api/prepare",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/api/generate",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "websocket",
              method: "GET",
              host: "example.com",
              path: "/api/chat/socket",
              matched: true,
              reason: "probe_observed_request",
            },
          ],
          events: [],
        },
      },
    },
  });

  assert.deepEqual(report.latestFlow.likelyGenerationCandidates, [
    {
      requestKind: "websocket",
      method: "GET",
      host: "example.com",
      path: "/api/chat/socket",
      matched: true,
      reason: "probe_observed_request",
      score: 100,
      signals: ["streaming_transport", "generation_path", "chat_path", "non_post_method"],
    },
    {
      requestKind: "xhr",
      method: "POST",
      host: "example.com",
      path: "/api/chat/stream",
      matched: true,
      reason: "probe_observed_request",
      score: 90,
      signals: ["post_method", "generation_path", "stream_path", "chat_path"],
    },
    {
      requestKind: "fetch",
      method: "POST",
      host: "example.com",
      path: "/api/generate",
      matched: true,
      reason: "probe_observed_request",
      score: 70,
      signals: ["post_method", "generation_path"],
    },
    {
      requestKind: "fetch",
      method: "GET",
      host: "example.com",
      path: "/api/conversations",
      matched: true,
      reason: "probe_observed_request",
      score: 10,
      signals: ["metadata_path", "non_post_method"],
    },
  ]);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("conversation=secret"), false);
});

test("createProbeReport creates an adapter draft from likely generation candidates", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: false,
      host: "example.com",
    },
    settings: {
      enabled: true,
      debugLogs: false,
    },
    popupStatus: {
      diagnostics: {
        latestFlow: {
          flowId: "probe:example.com:1780761600000",
          siteId: "page-probe",
          displayName: "Page Probe",
          updatedAt: 1780761602000,
          requestCandidates: [
            {
              requestKind: "xhr",
              method: "POST",
              host: "example.com",
              path: "/api/chat/stream?conversation=secret",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/api/generate?token=secret",
              matched: true,
              reason: "probe_observed_request",
            },
          ],
          events: [],
        },
      },
    },
  });

  assert.deepEqual(report.latestFlow.adapterDraft, {
    host: "example.com",
    siteIdSuggestion: "example",
    displayNameSuggestion: "Example",
    confidence: "medium",
    promptExtractorSuggestion: "none",
    lifecycleBridgeConfigSuggestion: {
      hosts: ["example.com"],
      generationRequestMatchers: [
        { pathname: "/api/chat/stream" },
        { pathname: "/api/generate" },
      ],
    },
    rationale: [
      "Top candidate /api/chat/stream scored 90 from post_method, generation_path, stream_path, chat_path.",
      "Candidate paths are same-host and sanitized; query strings, bodies, and headers are omitted.",
    ],
    manualChecks: [
      "Confirm the top matcher stays open until the visible AI response is complete.",
      "Confirm prompt extraction can use visible editor text or implement a safe request-body extractor.",
      "Confirm send detection, session key extraction, cancellation, and same-tab session switching.",
    ],
  });

  const serialized = JSON.stringify(report.latestFlow.adapterDraft);
  assert.equal(serialized.includes("conversation=secret"), false);
  assert.equal(serialized.includes("token=secret"), false);
});

test("createProbeReport includes an adapter readiness analysis", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: false,
      host: "example.com",
    },
    settings: {
      enabled: true,
      debugLogs: false,
    },
    popupStatus: {
      diagnostics: {
        latestFlow: {
          flowId: "probe:example.com:1780761600000",
          siteId: "page-probe",
          displayName: "Page Probe",
          updatedAt: 1780761602000,
          requestCandidates: [
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/api/prepare?token=secret",
              matched: true,
              reason: "probe_observed_request",
            },
            {
              requestKind: "eventsource",
              method: "GET",
              host: "example.com",
              path: "/api/chat/events?conversation=secret",
              matched: true,
              reason: "probe_observed_request",
            },
          ],
          events: [],
        },
      },
    },
  });

  assert.deepEqual(report.latestFlow.analysis, {
    readiness: "needs_manual_verification",
    topCandidate: {
      requestKind: "eventsource",
      method: "GET",
      host: "example.com",
      path: "/api/chat/events",
      score: 110,
      signals: ["streaming_transport", "generation_path", "stream_path", "chat_path", "non_post_method"],
    },
    candidateSummary: [
      "1. GET /api/chat/events via eventsource scored 110 (streaming_transport, generation_path, stream_path, chat_path, non_post_method).",
    ],
    riskSignals: [
      "Top candidate uses a streaming transport; URL matching is visible, but message contents are not inspected by probe mode.",
      "Prepare/warmup candidates were observed; keep them out of generation matchers unless completion evidence proves otherwise.",
    ],
    nextChecks: [
      "Verify whether the top candidate stays active until the visible answer is complete.",
      "Send a longer prompt and confirm the same candidate remains the strongest signal.",
      "Switch away from the tab during generation and confirm the candidate is still observed.",
      "Check cancellation/failure behavior before sending completion notifications.",
    ],
  });

  const serialized = JSON.stringify(report.latestFlow.analysis);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("conversation=secret"), false);
});

test("createProbeReport compares probe samples and highlights stable candidates", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: false,
      host: "example.com",
    },
    settings: {
      enabled: true,
      debugLogs: false,
    },
    popupStatus: {
      diagnostics: {
        latestFlow: {
          flowId: "probe:example.com:long",
          siteId: "page-probe",
          displayName: "Page Probe",
          updatedAt: 1780761602000,
          requestCandidates: [
            {
              requestKind: "fetch",
              method: "POST",
              host: "example.com",
              path: "/api/chat/stream?token=secret",
              matched: true,
              reason: "probe_observed_request",
            },
          ],
          events: [],
        },
        probeSamples: [
          {
            flowId: "probe:example.com:short",
            siteId: "page-probe",
            displayName: "Page Probe",
            scenario: "short_response",
            updatedAt: 1780761601000,
            requestCandidates: [
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/chat/stream?token=secret",
                matched: true,
                reason: "probe_observed_request",
              },
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/prepare?token=secret",
                matched: false,
                reason: "path_not_matched",
              },
            ],
          },
          {
            flowId: "probe:example.com:long",
            siteId: "page-probe",
            displayName: "Page Probe",
            scenario: "long_response",
            updatedAt: 1780761602000,
            requestCandidates: [
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/chat/stream?token=secret",
                matched: true,
                reason: "probe_observed_request",
              },
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/prepare?token=secret",
                matched: false,
                reason: "path_not_matched",
              },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(report.probeComparison, {
    sampleCount: 2,
    stableCandidates: [
      {
        requestKind: "fetch",
        method: "POST",
        host: "example.com",
        path: "/api/chat/stream",
        matched: true,
        reason: "probe_observed_request",
        sampleCount: 2,
        stability: "2/2",
        scenarios: ["short_response", "long_response"],
        score: 90,
        signals: ["post_method", "generation_path", "stream_path", "chat_path"],
      },
    ],
    stableIgnoredCandidates: [
      {
        requestKind: "fetch",
        method: "POST",
        host: "example.com",
        path: "/api/prepare",
        matched: false,
        reason: "path_not_matched",
        sampleCount: 2,
        stability: "2/2",
        scenarios: ["short_response", "long_response"],
        score: 0,
        signals: ["post_method", "prepare_path"],
      },
    ],
    sampleSummaries: [
      {
        flowId: "probe:example.com:short",
        scenario: "short_response",
        candidateCount: 2,
        updatedAt: 1780761601000,
      },
      {
        flowId: "probe:example.com:long",
        scenario: "long_response",
        candidateCount: 2,
        updatedAt: 1780761602000,
      },
    ],
    scenarioCoverage: [
      { scenario: "short_response", sampleCount: 1, latestUpdatedAt: 1780761601000 },
      { scenario: "long_response", sampleCount: 1, latestUpdatedAt: 1780761602000 },
      { scenario: "tab_switch", sampleCount: 0, latestUpdatedAt: null },
      { scenario: "same_tab_session_switch", sampleCount: 0, latestUpdatedAt: null },
      { scenario: "canceled_generation", sampleCount: 0, latestUpdatedAt: null },
      { scenario: "failed_generation", sampleCount: 0, latestUpdatedAt: null },
    ],
  });
  assert.deepEqual(report.recommendation, {
    status: "ready_for_adapter_draft",
    summary: "Stable generation candidate covers short and long response samples.",
    missingScenarios: [],
    primaryCandidate: {
      requestKind: "fetch",
      method: "POST",
      host: "example.com",
      path: "/api/chat/stream",
      score: 90,
      stability: "2/2",
      scenarios: ["short_response", "long_response"],
    },
    nextActions: [
      "Confirm the candidate stays active until visible completion.",
      "Use the stable candidate as the first adapter matcher draft.",
    ],
  });
  assert.deepEqual(report.adapterDraft, {
    host: "example.com",
    siteIdSuggestion: "example",
    displayNameSuggestion: "Example",
    confidence: "medium",
    promptExtractorSuggestion: "none",
    lifecycleBridgeConfigSuggestion: {
      hosts: ["example.com"],
      generationRequestMatchers: [{ pathname: "/api/chat/stream" }],
    },
    excludedRequestCandidates: [
      {
        requestKind: "fetch",
        method: "POST",
        host: "example.com",
        path: "/api/prepare",
        reason: "path_not_matched",
        stability: "2/2",
        scenarios: ["short_response", "long_response"],
      },
    ],
    implementationNotes: {
      lifecycle: {
        hosts: ["example.com"],
        generationRequestMatchers: [{ pathname: "/api/chat/stream" }],
        excludedPathnames: ["/api/prepare"],
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
    },
    source: "probeComparison.stableCandidates",
    rationale: [
      "Stable candidate /api/chat/stream appeared in 2/2 retained probe samples.",
      "Covered scenarios: short_response, long_response.",
      "Candidate paths are same-host and sanitized; query strings, bodies, and headers are omitted.",
    ],
    manualChecks: [
      "Confirm the top matcher stays open until the visible AI response is complete.",
      "Confirm prompt extraction can use visible editor text or implement a safe request-body extractor.",
      "Confirm send detection, session key extraction, cancellation, and same-tab session switching.",
    ],
  });

  const serialized = JSON.stringify(report.adapterDraft);
  assert.equal(serialized.includes("token=secret"), false);
});

test("createProbeReport recommends collecting missing key scenarios", () => {
  const report = createProbeReport({
    generatedAt: 1780761600000,
    currentPage: {
      supported: false,
      host: "example.com",
    },
    settings: {
      enabled: true,
      debugLogs: false,
    },
    popupStatus: {
      diagnostics: {
        probeSamples: [
          {
            flowId: "probe:example.com:short-1",
            scenario: "short_response",
            updatedAt: 1780761601000,
            requestCandidates: [
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/chat/stream",
                matched: true,
                reason: "probe_observed_request",
              },
            ],
          },
          {
            flowId: "probe:example.com:short-2",
            scenario: "short_response",
            updatedAt: 1780761602000,
            requestCandidates: [
              {
                requestKind: "fetch",
                method: "POST",
                host: "example.com",
                path: "/api/chat/stream",
                matched: true,
                reason: "probe_observed_request",
              },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(report.recommendation, {
    status: "collect_more_samples",
    summary: "Stable candidate found, but key probe scenarios are still missing.",
    missingScenarios: ["long_response"],
    primaryCandidate: {
      requestKind: "fetch",
      method: "POST",
      host: "example.com",
      path: "/api/chat/stream",
      score: 90,
      stability: "2/2",
      scenarios: ["short_response"],
    },
    nextActions: [
      "Run page probe for a long response.",
      "Confirm the stable candidate appears in the missing scenarios.",
    ],
  });
  assert.equal(report.adapterDraft, null);
});

test("createTestNotificationMessage uses the expected type", () => {
  assert.deepEqual(createTestNotificationMessage(), {
    type: MESSAGE_TYPES.TEST_NOTIFICATION,
    payload: {},
  });
});

test("createStartPageProbeMessage creates a sanitized active tab probe request", () => {
  assert.deepEqual(createStartPageProbeMessage({
    tabId: 42,
    host: "Example.COM ",
    scenario: "long_response",
    url: "https://example.com/private?token=secret",
  }), {
    type: MESSAGE_TYPES.START_PAGE_PROBE,
    payload: {
      tabId: 42,
      host: "example.com",
      scenario: "long_response",
    },
  });
});

test("createStartPageProbeMessage falls back for unknown probe scenarios", () => {
  assert.deepEqual(createStartPageProbeMessage({
    tabId: 42,
    host: "Example.COM ",
    scenario: "private scenario with token",
  }), {
    type: MESSAGE_TYPES.START_PAGE_PROBE,
    payload: {
      tabId: 42,
      host: "example.com",
      scenario: "unspecified",
    },
  });
});
