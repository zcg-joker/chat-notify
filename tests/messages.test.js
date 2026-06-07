const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
  createDiagnosticEventMessage,
  createResponseCompletedMessage,
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

test("createTestNotificationMessage uses the expected type", () => {
  assert.deepEqual(createTestNotificationMessage(), {
    type: MESSAGE_TYPES.TEST_NOTIFICATION,
    payload: {},
  });
});
