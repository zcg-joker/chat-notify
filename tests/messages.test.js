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
    url: "https://example.com/private?token=secret",
  }), {
    type: MESSAGE_TYPES.START_PAGE_PROBE,
    payload: {
      tabId: 42,
      host: "example.com",
    },
  });
});
