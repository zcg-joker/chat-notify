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
  XMLHttpRequestCtor,
  consoleApi,
} = {}) {
  const messages = [];
  const listeners = new Map();
  const url = new URL(location);
  const window = {
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
    },
    fetch: fetchImpl,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
    },
  };
  const context = {
    window,
    URL,
    URLSearchParams,
    Response: ResponseCtor,
    ReadableStream,
    DOMException,
    Date,
    Promise,
  };
  if (XMLHttpRequestCtor) {
    window.XMLHttpRequest = XMLHttpRequestCtor;
    context.XMLHttpRequest = XMLHttpRequestCtor;
  }
  if (consoleApi) {
    context.console = consoleApi;
  }

  vm.runInNewContext(BRIDGE_SOURCE, context, { filename: BRIDGE_PATH });

  return {
    window,
    messages,
    listeners,
    details() {
      return messages.map((entry) => entry.message.detail);
    },
  };
}

function createFakeXMLHttpRequestClass() {
  return class FakeXMLHttpRequest {
    constructor() {
      this._listeners = new Map();
      this.readyState = 0;
      this.status = 200;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    addEventListener(type, listener) {
      this._listeners.set(type, listener);
    }

    send(body) {
      this.body = body;
      const listener = this._listeners.get("loadend");
      if (listener) {
        listener.call(this);
      }
    }
  };
}

function createManualFakeXMLHttpRequestClass() {
  return class ManualFakeXMLHttpRequest {
    constructor() {
      this._listeners = new Map();
      this.status = 200;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    addEventListener(type, listener) {
      const listeners = this._listeners.get(type) || [];
      listeners.push(listener);
      this._listeners.set(type, listeners);
    }

    send(body) {
      this.body = body;
    }

    dispatch(type) {
      for (const listener of this._listeners.get(type) || []) {
        listener.call(this);
      }
    }
  };
}

function lifecycleDetails(messages) {
  return messages.map((entry) => entry.message.detail);
}

function installChatGptBridgeConfig(bridge) {
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "chatgpt",
        hosts: ["chatgpt.com", "chat.openai.com"],
        generationRequestMatchers: [
          { pathname: "/backend-api/conversation" },
          { pathname: "/backend-api/f/conversation" },
          { pathname: "/conversation" },
        ],
        promptExtractor: "chatgpt",
      },
    },
  });
}

function installPageProbeBridgeConfig(bridge) {
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "page-probe",
        hosts: ["example.com"],
        generationRequestMatchers: [{ pathnameIncludes: "/" }],
        promptExtractor: "none",
        probeOnly: true,
      },
    },
  });
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
  installChatGptBridgeConfig(bridge);

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

test("extracts only a prompt excerpt from ChatGPT generation request body", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  installChatGptBridgeConfig(bridge);

  await bridge.window.fetch("/backend-api/f/conversation", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        {
          author: { role: "user" },
          content: { parts: ["previous question"] },
        },
        {
          author: { role: "assistant" },
          content: { parts: ["previous answer"] },
        },
        {
          author: { role: "user" },
          content: { parts: ["简单说一下迈阿密的气候、人口和旅行亮点，控制在三句话以内"] },
        },
      ],
    }),
  });

  assert.equal(
    bridge.details()[0].promptExcerpt,
    "简单说一下迈阿密的气候、人口和旅行亮点，控制在三句话以内"
  );
  assert.equal(Object.hasOwn(bridge.details()[0], "body"), false);
  assert.equal(Object.hasOwn(bridge.details()[0], "messages"), false);
});

test("writes lifecycle bridge logs only after debug logs are enabled", async () => {
  const logs = [];
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 204 }),
    consoleApi: {
      info(prefix, message, detail) {
        logs.push({ level: "info", prefix, message, detail });
      },
      warn(prefix, message, detail) {
        logs.push({ level: "warn", prefix, message, detail });
      },
      debug(prefix, message, detail) {
        logs.push({ level: "debug", prefix, message, detail });
      },
    },
  });
  installChatGptBridgeConfig(bridge);

  await bridge.window.fetch("/backend-api/conversation/extra", { method: "POST" });
  assert.deepEqual(logs, []);

  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
      debugLogs: true,
    },
  });
  await bridge.window.fetch("/backend-api/conversation/extra", { method: "POST" });

  assert.deepEqual(
    logs.map((entry) => entry.message),
    ["page lifecycle bridge debug state changed", "fetch ignored by lifecycle bridge"]
  );
});

test("posts sanitized request probe events when debug logs are enabled", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  installChatGptBridgeConfig(bridge);
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
      debugLogs: true,
    },
  });

  await bridge.window.fetch("/backend-api/f/conversation?token=secret", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: "private body",
  });
  await bridge.window.fetch("/backend-api/not-conversation?token=secret", {
    method: "POST",
    body: "private body",
  });

  const probes = bridge.details().filter((detail) => detail.eventType === "request_probe");

  assert.deepEqual(JSON.parse(JSON.stringify(probes)), [
    {
      eventType: "request_probe",
      siteId: "chatgpt",
      requestKind: "fetch",
      method: "POST",
      host: "chatgpt.com",
      path: "/backend-api/f/conversation",
      matched: true,
      reason: "matched_generation_request",
    },
    {
      eventType: "request_probe",
      siteId: "chatgpt",
      requestKind: "fetch",
      method: "POST",
      host: "chatgpt.com",
      path: "/backend-api/not-conversation",
      matched: false,
      reason: "path_not_matched",
    },
  ]);
  const serialized = JSON.stringify(probes);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("private body"), false);
  assert.equal(serialized.includes("Bearer secret"), false);
});

test("page probe observes same-host fetches as request probes without lifecycle events", async () => {
  const bridge = createBridgeWindow({
    location: "https://example.com/chat",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  installPageProbeBridgeConfig(bridge);
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
      debugLogs: true,
    },
  });

  await bridge.window.fetch("https://example.com/api/chat?token=secret", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: "private body",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(bridge.details())), [
    {
      eventType: "request_probe",
      siteId: "page-probe",
      requestKind: "fetch",
      method: "POST",
      host: "example.com",
      path: "/api/chat",
      matched: true,
      reason: "probe_observed_request",
    },
  ]);
  const serialized = JSON.stringify(bridge.details());
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("private body"), false);
  assert.equal(serialized.includes("Bearer secret"), false);
});

test("page probe ignores cross-host fetches", async () => {
  const bridge = createBridgeWindow({
    location: "https://example.com/chat",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  installPageProbeBridgeConfig(bridge);
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
      debugLogs: true,
    },
  });

  await bridge.window.fetch("https://other.example/api/chat", { method: "POST" });

  assert.deepEqual(bridge.details(), []);
});

test("observes generation requests passed as URL objects", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  installChatGptBridgeConfig(bridge);

  await bridge.window.fetch(new URL("https://chatgpt.com/backend-api/conversation?model=gpt-test"), {
    method: "POST",
  });

  assert.deepEqual(
    bridge.details().map((detail) => detail.phase),
    ["started", "completed"]
  );
  assert.deepEqual(
    bridge.details().map((detail) => detail.url),
    [
      "https://chatgpt.com/backend-api/conversation",
      "https://chatgpt.com/backend-api/conversation",
    ]
  );
});

test("observes only exact ChatGPT generation paths", async () => {
  const requestedUrls = [];
  const bridge = createBridgeWindow({
    fetchImpl: async (input) => {
      requestedUrls.push(typeof input === "string" ? input : input.url);
      return new Response(null, { status: 204 });
    },
  });
  installChatGptBridgeConfig(bridge);

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

test("fails closed when a streaming response cannot be cloned for monitoring", async () => {
  const response = new Response("hello", { status: 200 });
  Object.defineProperty(response, "clone", {
    value() {
      throw new Error("clone unavailable");
    },
  });
  const bridge = createBridgeWindow({
    fetchImpl: async () => response,
  });
  installChatGptBridgeConfig(bridge);

  const returnedResponse = await bridge.window.fetch("/backend-api/conversation", { method: "POST" });

  assert.equal(returnedResponse, response);
  assert.deepEqual(
    bridge.details().map((detail) => detail.phase),
    ["started", "failed"]
  );
});

test("fails closed when a cloned streaming response cannot be read for monitoring", async () => {
  const response = new Response("hello", { status: 200 });
  Object.defineProperty(response, "clone", {
    value() {
      return { body: {} };
    },
  });
  const bridge = createBridgeWindow({
    fetchImpl: async () => response,
  });
  installChatGptBridgeConfig(bridge);

  const returnedResponse = await bridge.window.fetch("/backend-api/conversation", { method: "POST" });

  assert.equal(returnedResponse, response);
  assert.deepEqual(
    bridge.details().map((detail) => detail.phase),
    ["started", "failed"]
  );
});

test("emits failed instead of completed for HTTP error responses without bodies", async () => {
  const bridge = createBridgeWindow({
    fetchImpl: async () => new Response(null, { status: 500 }),
  });
  installChatGptBridgeConfig(bridge);

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
  installChatGptBridgeConfig(bridge);

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
  installChatGptBridgeConfig(bridge);

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

test("matches configured Gemini generation requests", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
        promptExtractor: "gemini",
      },
    },
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: JSON.stringify([[[["Explain Kubernetes simply"]]]]),
  });

  assert.equal(bridge.details()[0].siteId, "gemini");
  assert.equal(bridge.details()[0].phase, "started");
  assert.equal(bridge.details()[0].promptExcerpt, "Explain Kubernetes simply");
  assert.equal(bridge.details().at(-1).phase, "completed");
});

test("observes configured Gemini generation XMLHttpRequests", () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    XMLHttpRequestCtor: createFakeXMLHttpRequestClass(),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "BardChatUi/data/batchexecute" }],
        promptExtractor: "gemini",
      },
    },
  });

  const xhr = new bridge.window.XMLHttpRequest();
  xhr.open("POST", "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=wrb.fr");
  xhr.send(JSON.stringify([[[["Explain Kubernetes simply"]]]]));

  assert.equal(bridge.details()[0].siteId, "gemini");
  assert.equal(bridge.details()[0].phase, "started");
  assert.equal(bridge.details()[0].method, "POST");
  assert.equal(bridge.details()[0].promptExcerpt, "Explain Kubernetes simply");
  assert.equal(bridge.details().at(-1).phase, "completed");
});

test("extracts Gemini prompt excerpts from form-encoded batch XHR bodies", () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    XMLHttpRequestCtor: createFakeXMLHttpRequestClass(),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "BardChatUi/data/batchexecute" }],
        promptExtractor: "gemini",
      },
    },
  });

  const body = new URLSearchParams({
    "f.req": JSON.stringify(["wrb.fr", "StreamGenerate", [[["Explain Kubernetes simply"]]]]),
    at: "sensitive-token",
  }).toString();

  const xhr = new bridge.window.XMLHttpRequest();
  xhr.open("POST", "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=wrb.fr");
  xhr.send(body);

  assert.equal(bridge.details()[0].promptExcerpt, "Explain Kubernetes simply");
  assert.equal(Object.hasOwn(bridge.details()[0], "body"), false);
});

test("logs only one terminal XHR lifecycle phase", () => {
  const logs = [];
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    XMLHttpRequestCtor: createManualFakeXMLHttpRequestClass(),
    consoleApi: {
      info(prefix, message, detail) {
        logs.push({ level: "info", prefix, message, detail });
      },
      warn(prefix, message, detail) {
        logs.push({ level: "warn", prefix, message, detail });
      },
    },
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "BardChatUi/data/batchexecute" }],
        promptExtractor: "gemini",
      },
    },
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
      debugLogs: true,
    },
  });

  const xhr = new bridge.window.XMLHttpRequest();
  xhr.open("POST", "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=wrb.fr");
  xhr.send(JSON.stringify([[[["Explain Kubernetes simply"]]]]));
  xhr.dispatch("abort");
  xhr.dispatch("loadend");

  const terminalLifecycleLogs = logs.filter((entry) => /^lifecycle (completed|failed|canceled): xhr/.test(entry.message));
  assert.deepEqual(terminalLifecycleLogs.map((entry) => entry.message), ["lifecycle canceled: xhr abort"]);
  assert.deepEqual(
    bridge.details().filter((detail) => detail.phase).map((detail) => detail.phase),
    ["started", "canceled"]
  );
});

test("omits Gemini prompt excerpt when request body is malformed JSON", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
        promptExtractor: "gemini",
      },
    },
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: "{not-json Explain Kubernetes simply",
  });

  assert.equal(bridge.details()[0].phase, "started");
  assert.equal(Object.hasOwn(bridge.details()[0], "promptExcerpt"), false);
  assert.equal(bridge.details().at(-1).phase, "completed");
});

test("extracts Gemini prompt after ignoring metadata strings", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
        promptExtractor: "gemini",
      },
    },
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: JSON.stringify([
      "StreamGenerate",
      ["POST", "BardFrontendService"],
      ["https://gemini.google.com/_/BardChatUi/data"],
      [[["Explain Kubernetes simply"]]],
    ]),
  });

  assert.equal(bridge.details()[0].promptExcerpt, "Explain Kubernetes simply");
});

test("ignores fetches until bridge config is received", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: JSON.stringify([[[["Explain Kubernetes simply"]]]]),
  });

  assert.equal(bridge.details().length, 0);
});

test("ignores bridge configs with invalid or missing prompt extractor", async () => {
  const invalidConfigs = [
    {
      siteId: "gemini",
      hosts: ["gemini.google.com"],
      generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
      promptExtractor: "unknown",
    },
    {
      siteId: "gemini",
      hosts: ["gemini.google.com"],
      generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
    },
  ];

  for (const config of invalidConfigs) {
    const bridge = createBridgeWindow({
      location: "https://gemini.google.com/app",
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    bridge.listeners.get("message")({
      source: bridge.window,
      data: {
        source: "chat-notify-content-script",
        type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
        config,
      },
    });

    await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
      method: "POST",
      body: JSON.stringify([[[["Explain Kubernetes simply"]]]]),
    });

    assert.equal(bridge.details().length, 0);
  }
});
