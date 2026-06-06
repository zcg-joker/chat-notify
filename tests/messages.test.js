const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
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

test("createTestNotificationMessage uses the expected type", () => {
  assert.deepEqual(createTestNotificationMessage(), {
    type: MESSAGE_TYPES.TEST_NOTIFICATION,
    payload: {},
  });
});
