const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatGptAdapter } = require("../src/adapters/chatgpt-adapter.js");

test("matches ChatGPT hosts", () => {
  const adapter = createChatGptAdapter();

  assert.equal(adapter.matchesLocation(new URL("https://chatgpt.com/c/abc")), true);
  assert.equal(adapter.matchesLocation(new URL("https://chat.openai.com/c/abc")), true);
  assert.equal(adapter.matchesLocation(new URL("https://claude.ai/chat/abc")), false);
});

test("exposes ChatGPT adapter metadata", () => {
  const adapter = createChatGptAdapter();

  assert.equal(adapter.siteId, "chatgpt");
  assert.equal(adapter.displayName, "ChatGPT");
  assert.equal(adapter.canObserveLifecycle, true);
});

test("extracts stable session key from conversation URL", () => {
  const adapter = createChatGptAdapter();

  assert.equal(
    adapter.getSessionKey(new URL("https://chatgpt.com/c/12345"), null),
    "conversation:12345"
  );
});

test("uses temporary session key for new chat URL", () => {
  const adapter = createChatGptAdapter({ tempKeySeed: () => "seed-1" });

  assert.equal(adapter.getSessionKey(new URL("https://chatgpt.com/"), null), "temp:chatgpt:seed-1");
});

test("normalizes lifecycle events without forwarding body data", () => {
  const adapter = createChatGptAdapter();
  const event = adapter.normalizeLifecycleEvent({
    lifecycleId: "life-1",
    phase: "completed",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
    body: "sensitive",
    responseText: "sensitive",
  });

  assert.deepEqual(event, {
    type: "GENERATION_COMPLETED",
    lifecycleId: "life-1",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
  });
});

test("ignores lifecycle events for non-generation URLs", () => {
  const adapter = createChatGptAdapter();

  assert.equal(
    adapter.normalizeLifecycleEvent({
      phase: "completed",
      url: "https://chatgpt.com/some-other-route",
    }),
    null
  );
});

test("ignores empty lifecycle events", () => {
  const adapter = createChatGptAdapter();

  assert.equal(adapter.normalizeLifecycleEvent(null), null);
});
