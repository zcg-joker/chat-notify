const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatGptAdapter } = require("../src/adapters/chatgpt-adapter.js");
const { validateAdapter, REQUIRED_ADAPTER_METHODS } = require("../src/adapters/adapter-contract.js");

function createButton({ ariaLabel = "", textContent = "", testId = "" } = {}) {
  return {
    textContent,
    getAttribute(name) {
      if (name === "aria-label") {
        return ariaLabel;
      }
      if (name === "data-testid") {
        return testId;
      }
      return "";
    },
  };
}

function createClickTarget(button) {
  return {
    closest(selector) {
      return selector === "button" ? button : null;
    },
  };
}

function createRootWithButtons(buttons) {
  return {
    querySelectorAll(selector) {
      return selector === "button" ? buttons : [];
    },
  };
}

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

test("satisfies adapter contract validation", () => {
  assert.equal(validateAdapter(createChatGptAdapter()), true);
});

test("rejects adapters missing metadata", () => {
  const methodsOnlyAdapter = Object.fromEntries(
    REQUIRED_ADAPTER_METHODS.map((method) => [method, () => null])
  );

  assert.equal(validateAdapter(methodsOnlyAdapter), false);
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

test("reuses temporary session key for new chat URL within adapter instance", () => {
  let seedCalls = 0;
  const adapter = createChatGptAdapter({
    tempKeySeed: () => {
      seedCalls += 1;
      return `seed-${seedCalls}`;
    },
  });

  const first = adapter.getSessionKey(new URL("https://chatgpt.com/"), null);
  const second = adapter.getSessionKey(new URL("https://chatgpt.com/"), null);

  assert.equal(first, "temp:chatgpt:seed-1");
  assert.equal(second, first);
  assert.equal(seedCalls, 1);
});

test("recognizes localized send button labels", () => {
  const adapter = createChatGptAdapter();

  assert.equal(
    adapter.isSendEvent({
      type: "click",
      target: createClickTarget(createButton({ ariaLabel: "发送消息" })),
    }),
    true
  );
  assert.equal(
    adapter.isSendEvent({
      type: "click",
      target: createClickTarget(createButton({ textContent: "发送" })),
    }),
    true
  );
});

test("recognizes localized responding controls", () => {
  const adapter = createChatGptAdapter();

  assert.equal(adapter.isResponding(createRootWithButtons([createButton({ ariaLabel: "停止生成" })])), true);
  assert.equal(adapter.isResponding(createRootWithButtons([createButton({ textContent: "取消" })])), true);
});

test("normalizes lifecycle events without forwarding body data", () => {
  const adapter = createChatGptAdapter();
  const event = adapter.normalizeLifecycleEvent({
    lifecycleId: "life-1",
    phase: "completed",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
    promptExcerpt: "current prompt",
    headers: { authorization: "Bearer sensitive" },
    authorization: "Bearer sensitive",
    token: "sensitive",
    body: "sensitive",
    responseText: "sensitive",
  });

  assert.deepEqual(event, {
    type: "GENERATION_COMPLETED",
    lifecycleId: "life-1",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
    promptExcerpt: "current prompt",
  });
  assert.equal(Object.hasOwn(event, "headers"), false);
  assert.equal(Object.hasOwn(event, "authorization"), false);
  assert.equal(Object.hasOwn(event, "token"), false);
  assert.equal(Object.hasOwn(event, "body"), false);
  assert.equal(Object.hasOwn(event, "responseText"), false);
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

test("ignores generation paths on non-ChatGPT hosts", () => {
  const adapter = createChatGptAdapter();

  assert.equal(
    adapter.normalizeLifecycleEvent({
      phase: "completed",
      url: "https://example.com/backend-api/conversation",
    }),
    null
  );
});
