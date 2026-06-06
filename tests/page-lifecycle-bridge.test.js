const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BRIDGE_PATH = path.join(__dirname, "../src/content/page-lifecycle-bridge.js");
const BRIDGE_SOURCE = fs.readFileSync(BRIDGE_PATH, "utf8");
const TERMINAL_PHASES = new Set(["completed", "canceled", "failed"]);

function createBridgeWindow({
  location = "https://chatgpt.com/c/test-chat",
  fetchImpl = async () => new Response(null, { status: 204 }),
  ResponseCtor = Response,
} = {}) {
  const messages = [];
  const url = new URL(location);
  const window = {
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
    },
    fetch: fetchImpl,
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
    },
  };
  const context = {
    window,
    URL,
    Response: ResponseCtor,
    ReadableStream,
    DOMException,
    Date,
    Promise,
  };

  vm.runInNewContext(BRIDGE_SOURCE, context, { filename: BRIDGE_PATH });

  return {
    window,
    messages,
    details() {
      return messages.map((entry) => entry.message.detail);
    },
  };
}

function lifecycleDetails(messages) {
  return messages.map((entry) => entry.message.detail);
}

async function waitFor(predicate) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("normalizes relative generation request URLs before posting lifecycle events", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  await bridge.window.fetch("/backend-api/conversation?model=gpt-test", {
    method: "POST",
    headers: { authorization: "Bearer sensitive" },
    body: "prompt text must stay private",
  });

  assert.deepEqual(
    bridge.details().map((detail) => detail.url),
    [
      "https://chatgpt.com/backend-api/conversation",
      "https://chatgpt.com/backend-api/conversation",
    ]
  );
  assert.deepEqual(
    bridge.details().map((detail) => detail.method),
    ["POST", "POST"]
  );
  assert.equal(Object.hasOwn(bridge.details()[0], "headers"), false);
  assert.equal(Object.hasOwn(bridge.details()[0], "body"), false);
});

test("observes only exact ChatGPT generation paths", async () => {
  const requestedUrls = [];
  const bridge = createBridgeWindow({
    fetchImpl: async (input) => {
      requestedUrls.push(typeof input === "string" ? input : input.url);
      return new Response(null, { status: 204 });
    },
  });

  await bridge.window.fetch("/backend-api/conversation", { method: "POST" });
  await bridge.window.fetch("/backend-api/f/conversation", { method: "POST" });
  await bridge.window.fetch("https://chatgpt.com/conversation?temporary=true", { method: "POST" });
  await bridge.window.fetch("/backend-api/conversation/extra", { method: "POST" });
  await bridge.window.fetch("/backend-api/not-conversation", { method: "POST" });
  await bridge.window.fetch("https://example.com/backend-api/conversation", { method: "POST" });

  assert.deepEqual(
    bridge
      .details()
      .filter((detail) => detail.phase === "started")
      .map((detail) => detail.url),
    [
      "https://chatgpt.com/backend-api/conversation",
      "https://chatgpt.com/backend-api/f/conversation",
      "https://chatgpt.com/conversation",
    ]
  );
  assert.deepEqual(requestedUrls, [
    "/backend-api/conversation",
    "/backend-api/f/conversation",
    "https://chatgpt.com/conversation?temporary=true",
    "/backend-api/conversation/extra",
    "/backend-api/not-conversation",
    "https://example.com/backend-api/conversation",
  ]);
});

test("emits failed instead of completed for HTTP error responses without bodies", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 500 }),
  });

  const response = await bridge.window.fetch("/backend-api/conversation", { method: "POST" });

  assert.equal(response.status, 500);
  assert.deepEqual(
    bridge.details().map((detail) => detail.phase),
    ["started", "failed"]
  );
});

test("preserves the original fetch Response while monitoring a clone", async () => {
  const originalResponse = new Response("hello", {
    status: 201,
    statusText: "Created",
    headers: { "x-original": "yes" },
  });
  originalResponse.customProperty = "kept";

  const bridge = createBridgeWindow({
    fetchImpl: async () => originalResponse,
  });

  const returnedResponse = await bridge.window.fetch("/backend-api/conversation", { method: "POST" });
  const returnedText = await returnedResponse.text();
  await waitFor(() => bridge.details().some((detail) => detail.phase === "completed"));

  assert.equal(returnedResponse, originalResponse);
  assert.equal(returnedResponse.customProperty, "kept");
  assert.equal(returnedResponse.status, 201);
  assert.equal(returnedResponse.statusText, "Created");
  assert.equal(returnedResponse.headers.get("x-original"), "yes");
  assert.equal(returnedText, "hello");
  assert.deepEqual(
    bridge.details().map((detail) => detail.phase),
    ["started", "completed"]
  );
});

test("emits at most one terminal lifecycle phase per request", async () => {
  class FakeResponse {
    constructor(body = null, init = {}) {
      this.body = body;
      this.ok = init.ok !== false;
      this.status = init.status || 200;
      this.statusText = init.statusText || "OK";
      this.headers = init.headers || new Headers();
    }

    clone() {
      return {
        body: {
          getReader() {
            return {
              async read() {
                throw new DOMException("The operation was aborted.", "AbortError");
              },
            };
          },
        },
      };
    }
  }

  let originalBodyCanceled = false;
  const originalResponse = new FakeResponse({
    getReader() {
      return {
        async read() {
          return { done: true };
        },
        async cancel() {
          originalBodyCanceled = true;
        },
      };
    },
  });
  const bridge = createBridgeWindow({
    fetchImpl: async () => originalResponse,
    ResponseCtor: FakeResponse,
  });

  const response = await bridge.window.fetch("/backend-api/conversation", { method: "POST" });
  await response.body.getReader().cancel("caller stopped reading");
  await waitFor(() => bridge.details().some((detail) => TERMINAL_PHASES.has(detail.phase)));

  const terminalsByLifecycleId = new Map();
  for (const detail of lifecycleDetails(bridge.messages)) {
    if (!TERMINAL_PHASES.has(detail.phase)) {
      continue;
    }
    const phases = terminalsByLifecycleId.get(detail.lifecycleId) || [];
    phases.push(detail.phase);
    terminalsByLifecycleId.set(detail.lifecycleId, phases);
  }

  for (const phases of terminalsByLifecycleId.values()) {
    assert.ok(phases.length <= 1, `expected at most one terminal phase, got ${phases.join(", ")}`);
  }
  assert.equal(response, originalResponse);
  assert.equal(originalBodyCanceled, true);
});
