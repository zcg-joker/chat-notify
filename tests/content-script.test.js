const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CONTENT_SCRIPT_PATH = path.join(__dirname, "../src/content/content-script.js");

function createFakeDocument() {
  const listeners = new Map();
  const scripts = [];
  const document = {
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
    documentElement: {
      appendChild(script) {
        scripts.push(script);
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "script");
      return {
        src: "",
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
    addEventListener(type, listener, useCapture) {
      listeners.set(type, { listener, useCapture });
    },
  };

  return { document, listeners, scripts };
}

function createContentScriptContext({
  enabled = true,
  debugLogs = false,
  supported = true,
  pageProbeSupported = false,
  location = "https://chatgpt.com/c/test",
  extraApi = {},
  consoleApi = console,
  now = () => 1780761600000,
} = {}) {
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, "utf8");
  const documentFixture = createFakeDocument();
  const sentMessages = [];
  const postedMessages = [];
  const intervals = [];
  const timeouts = [];
  const windowListeners = new Map();
  const storageChangeListeners = [];
  const controllerCalls = {
    handleUserSend: 0,
    handleLifecycleEvent: [],
    tick: 0,
  };
  const completionEventsByLifecycleType = new Map();
  let controllerOptions = null;
  const adapter = {
    siteId: "chatgpt",
    displayName: "ChatGPT",
    canObserveLifecycle: true,
    matchesLocation: () => supported,
    isSendEvent: (event) => Boolean(event && event.isSend),
    normalizeLifecycleEvent: (detail) => detail && detail.normalized,
    getLifecycleBridgeConfig: () => ({
      siteId: "chatgpt",
      hosts: ["chatgpt.com", "chat.openai.com"],
      generationRequestMatchers: [{ pathname: "/backend-api/f/conversation" }],
      promptExtractor: "chatgpt",
    }),
  };
  const pageProbeAdapter = {
    siteId: "page-probe",
    displayName: "Page Probe",
    canObserveLifecycle: true,
    completionStrategy: "probe_only",
    matchesLocation: () => pageProbeSupported,
    isSendEvent: () => false,
    normalizeLifecycleEvent: () => null,
    getLifecycleBridgeConfig: () => ({
      siteId: "page-probe",
      hosts: [new URL(location).hostname],
      generationRequestMatchers: [{ pathnameIncludes: "/" }],
      promptExtractor: "none",
      probeOnly: true,
    }),
  };
  const api = Object.assign({
    createChatGptAdapter: () => adapter,
    createPageProbeAdapter: () => pageProbeAdapter,
    createMonitorController: (options) => {
      controllerOptions = options;
      return {
        handleUserSend() {
          controllerCalls.handleUserSend += 1;
        },
        handleLifecycleEvent(event) {
          controllerCalls.handleLifecycleEvent.push(event);
          const completionEvent = completionEventsByLifecycleType.get(event.type);
          if (completionEvent) {
            controllerOptions.onCompleted(completionEvent);
          }
        },
        tick() {
          controllerCalls.tick += 1;
        },
      };
    },
    createResponseCompletedMessage: (event) => ({ type: "AI_RESPONSE_COMPLETED", payload: event }),
    createDiagnosticEventMessage: (event) => {
      const payload = {
        flowId: event.flowId || "",
        siteId: event.siteId || "",
        displayName: event.displayName || "",
        promptExcerpt: event.promptExcerpt || "",
        eventType: event.eventType || "",
        status: event.status === "failed" ? "failed" : "ok",
        message: typeof event.message === "string" ? event.message.split("\n")[0].trim() : "",
      };
      const request = event.request || event;
      if (request.requestKind || request.method || request.host || request.path || request.reason) {
        Object.assign(payload, {
          requestKind: request.requestKind || "",
          method: request.method || "",
          host: request.host || "",
          path: request.path || "",
          matched: Boolean(request.matched),
          reason: request.reason || "",
        });
      }
      return { type: "DIAGNOSTIC_EVENT", payload };
    },
  }, extraApi);
  const window = {
    location: new URL(location),
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    postMessage(message, targetOrigin) {
      postedMessages.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin });
    },
    setTimeout(callback) {
      timeouts.push(callback);
      return timeouts.length;
    },
    setInterval(callback, intervalMs) {
      intervals.push({ callback, intervalMs });
      return intervals.length;
    },
  };
  const chrome = {
    runtime: {
      getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      sendMessage(message, callback) {
        sentMessages.push(message);
        if (callback) {
          callback({ ok: true, notificationId: "notification-id" });
        }
      },
    },
    storage: {
      onChanged: {
        addListener(listener) {
          storageChangeListeners.push(listener);
        },
      },
      sync: {
        get(_defaults, callback) {
          callback({ enabled, debugLogs });
        },
      },
    },
  };
  const context = {
    ChatNotify: api,
    chrome,
    document: documentFixture.document,
    window,
    console: consoleApi,
    Date: Object.assign(function DateShim(...args) {
      return args.length ? new Date(...args) : new Date(now());
    }, Date, { now }),
    globalThis: null,
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: CONTENT_SCRIPT_PATH });

  return {
    adapter: controllerOptions && controllerOptions.adapter,
    getControllerOptions: () => controllerOptions,
    controllerCalls,
    completionEventsByLifecycleType,
    documentFixture,
    intervals,
    postedMessages,
    sentMessages,
    storageChangeListeners,
    timeouts,
    window,
    windowListeners,
  };
}

test("installs bridge and event listeners when enabled on a supported page", () => {
  const context = createContentScriptContext();

  assert.equal(context.documentFixture.scripts.length, 1);
  assert.equal(
    context.documentFixture.scripts[0].src,
    "chrome-extension://test/src/content/page-lifecycle-bridge.js"
  );
  assert.equal(context.documentFixture.listeners.get("click").useCapture, true);
  assert.equal(context.documentFixture.listeners.get("keydown").useCapture, true);
  assert.equal(context.windowListeners.has("message"), true);
  assert.equal(context.intervals[0].intervalMs, 500);
});

test("does not write debug logs by default", () => {
  const logs = [];
  const context = createContentScriptContext({
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

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt",
  });

  assert.deepEqual(logs, []);
});

test("does not install listeners when disabled", () => {
  const context = createContentScriptContext({ enabled: false });

  assert.equal(context.documentFixture.scripts.length, 0);
  assert.equal(context.documentFixture.listeners.size, 0);
  assert.equal(context.windowListeners.size, 0);
});

test("selects page probe adapter on unsupported active probe hosts", () => {
  const context = createContentScriptContext({
    supported: false,
    pageProbeSupported: true,
    location: "https://example.com/chat",
  });

  assert.equal(context.adapter.siteId, "page-probe");
  assert.equal(context.documentFixture.scripts.length, 1);
  context.documentFixture.scripts[0].onload();
  assert.deepEqual(context.postedMessages[0].message, {
    source: "chat-notify-content-script",
    type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
    config: {
      siteId: "page-probe",
      hosts: ["example.com"],
      generationRequestMatchers: [{ pathnameIncludes: "/" }],
      promptExtractor: "none",
      probeOnly: true,
    },
  });
});

test("page probe forwards matched request probes without notifying", () => {
  const context = createContentScriptContext({
    supported: false,
    pageProbeSupported: true,
    location: "https://example.com/chat",
  });

  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        eventType: "request_probe",
        siteId: "page-probe",
        requestKind: "fetch",
        method: "POST",
        host: "example.com",
        path: "/api/chat",
        matched: true,
        reason: "probe_observed_request",
      },
    },
  });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        phase: "completed",
        siteId: "page-probe",
        requestKind: "fetch",
        method: "POST",
        host: "example.com",
        path: "/api/chat",
      },
    },
  });

  const diagnostics = context.sentMessages.filter((message) => message.type === "DIAGNOSTIC_EVENT");
  assert.equal(context.sentMessages.some((message) => message.type === "AI_RESPONSE_COMPLETED"), false);
  assert.deepEqual(diagnostics.at(-1).payload, {
    flowId: "probe:example.com:1780761600000",
    siteId: "page-probe",
    displayName: "Page Probe",
    promptExcerpt: "",
    eventType: "request_probe_matched",
    status: "ok",
    message: "fetch POST example.com/api/chat probe_observed_request",
    requestKind: "fetch",
    method: "POST",
    host: "example.com",
    path: "/api/chat",
    matched: true,
    reason: "probe_observed_request",
  });
  assert.equal(context.controllerCalls.handleLifecycleEvent.length, 0);
});

test("installs observers when storage changes from disabled to enabled", () => {
  const context = createContentScriptContext({ enabled: false });

  context.storageChangeListeners[0]({ enabled: { newValue: true } }, "sync");

  assert.equal(context.documentFixture.scripts.length, 1);
  assert.equal(context.documentFixture.listeners.get("click").useCapture, true);
  assert.equal(context.windowListeners.has("message"), true);
  assert.equal(context.intervals[0].intervalMs, 500);
});

test("captures user send events and forwards normalized lifecycle messages", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: { normalized: { type: "GENERATION_STARTED", lifecycleId: "life-1" } },
    },
  });
  context.intervals[0].callback();

  assert.equal(context.controllerCalls.handleUserSend, 1);
  assert.deepEqual(context.controllerCalls.handleLifecycleEvent, [
    { type: "GENERATION_STARTED", lifecycleId: "life-1" },
  ]);
  assert.equal(context.controllerCalls.tick, 1);
});

test("captures user send before a same-turn lifecycle message", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: { normalized: { type: "GENERATION_STARTED", lifecycleId: "life-1" } },
    },
  });
  assert.equal(context.timeouts.length, 0);

  assert.equal(context.controllerCalls.handleUserSend, 1);
  assert.deepEqual(context.controllerCalls.handleLifecycleEvent, [
    { type: "GENERATION_STARTED", lifecycleId: "life-1" },
  ]);
});

test("stops processing send and lifecycle events after storage disables the extension", () => {
  const context = createContentScriptContext();

  context.storageChangeListeners[0]({ enabled: { newValue: false } }, "sync");
  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: { normalized: { type: "GENERATION_STARTED", lifecycleId: "life-1" } },
    },
  });
  context.intervals[0].callback();

  assert.equal(context.controllerCalls.handleUserSend, 0);
  assert.equal(context.controllerCalls.handleLifecycleEvent.length, 0);
  assert.equal(context.controllerCalls.tick, 0);
});

test("sends completion messages through runtime messaging", () => {
  const context = createContentScriptContext();

  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(context.sentMessages)), [
    {
      type: "AI_RESPONSE_COMPLETED",
      payload: {
        siteId: "chatgpt",
        sessionKey: "conversation:a",
        promptExcerpt: "Prompt",
        flowId: "",
      },
    },
  ]);
});

test("sends diagnostics for send and lifecycle events without session keys", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_STARTED",
          lifecycleId: "life-1",
          sessionKey: "conversation:a",
          promptExcerpt: "Prompt",
          url: "https://chatgpt.com/c/private",
        },
      },
    },
  });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_COMPLETED",
          lifecycleId: "life-1",
          sessionKey: "conversation:a",
          promptExcerpt: "Prompt",
          url: "https://chatgpt.com/c/private",
        },
      },
    },
  });

  const diagnostics = context.sentMessages.filter((message) => message.type === "DIAGNOSTIC_EVENT");
  assert.deepEqual(diagnostics.map((message) => message.payload), [
    {
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "",
      eventType: "send_captured",
      status: "ok",
      message: "",
    },
    {
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "Prompt",
      eventType: "lifecycle_started",
      status: "ok",
      message: "",
    },
    {
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "Prompt",
      eventType: "lifecycle_completed",
      status: "ok",
      message: "",
    },
  ]);
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("conversation:a"), false);
  assert.equal(serialized.includes("chatgpt.com/c/private"), false);
});

test("forwards request probe events as diagnostics without touching lifecycle state", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        eventType: "request_probe",
        siteId: "chatgpt",
        requestKind: "fetch",
        method: "POST",
        host: "chatgpt.com",
        path: "/backend-api/f/conversation",
        matched: true,
        reason: "matched_generation_request",
        url: "https://chatgpt.com/backend-api/f/conversation?token=secret",
      },
    },
  });

  const diagnostics = context.sentMessages.filter((message) => message.type === "DIAGNOSTIC_EVENT");
  assert.equal(context.controllerCalls.handleLifecycleEvent.length, 0);
  assert.deepEqual(diagnostics.at(-1).payload, {
    flowId: "chatgpt:1780761600000:1",
    siteId: "chatgpt",
    displayName: "ChatGPT",
    promptExcerpt: "",
    eventType: "request_probe_matched",
    status: "ok",
    message: "fetch POST chatgpt.com/backend-api/f/conversation matched_generation_request",
    requestKind: "fetch",
    method: "POST",
    host: "chatgpt.com",
    path: "/backend-api/f/conversation",
    matched: true,
    reason: "matched_generation_request",
  });
  assert.equal(JSON.stringify(diagnostics).includes("token=secret"), false);
});

test("does not let ignored probes after notification overwrite the active flow", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt",
  });
  const messagesBeforeProbe = context.sentMessages.length;

  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        eventType: "request_probe",
        siteId: "chatgpt",
        requestKind: "fetch",
        method: "POST",
        host: "chatgpt.com",
        path: "/backend-api/sentinel/ping",
        matched: false,
        reason: "path_not_matched",
      },
    },
  });

  assert.equal(context.sentMessages.length, messagesBeforeProbe);
});

test("can notify from a lifecycle message without waiting for interval tick", () => {
  const context = createContentScriptContext();
  context.completionEventsByLifecycleType.set("GENERATION_COMPLETED", {
    siteId: "gemini",
    displayName: "Gemini",
    sessionKey: "conversation:a",
    promptExcerpt: "Explain Kubernetes simply",
  });

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_COMPLETED",
          lifecycleId: "life-1",
          sessionKey: "conversation:a",
          promptExcerpt: "Explain Kubernetes simply",
        },
      },
    },
  });

  assert.equal(context.controllerCalls.tick, 0);
  assert.equal(context.sentMessages.at(-1).type, "AI_RESPONSE_COMPLETED");
  assert.equal(context.sentMessages.at(-1).payload.promptExcerpt, "Explain Kubernetes simply");
});

test("sends failed and canceled lifecycle diagnostics", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  for (const type of ["GENERATION_FAILED", "GENERATION_CANCELED"]) {
    context.windowListeners.get("message")({
      source: context.window,
      data: {
        source: "chat-notify-page-lifecycle-bridge",
        detail: {
          normalized: {
            type,
            lifecycleId: "life-1",
            promptExcerpt: "Prompt",
            errorMessage: "first line\nsecond line secret",
          },
        },
      },
    });
  }

  const diagnostics = context.sentMessages.filter((message) => message.type === "DIAGNOSTIC_EVENT");
  assert.deepEqual(diagnostics.map((message) => message.payload.eventType), [
    "send_captured",
    "lifecycle_failed",
    "lifecycle_canceled",
  ]);
  assert.equal(diagnostics[1].payload.status, "failed");
  assert.equal(diagnostics[1].payload.message, "first line");
  assert.equal(diagnostics[2].payload.status, "ok");
});

test("includes current flow id in completion messages", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt",
  });

  assert.equal(context.sentMessages.at(-1).type, "AI_RESPONSE_COMPLETED");
  assert.equal(context.sentMessages.at(-1).payload.flowId, "chatgpt:1780761600000:1");
});

test("keeps lifecycle diagnostics on their bound flow across overlapping sends", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_STARTED",
          lifecycleId: "life-a",
          sessionKey: "conversation:a",
          promptExcerpt: "Prompt A",
        },
      },
    },
  });
  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_STARTED",
          lifecycleId: "life-b",
          sessionKey: "conversation:b",
          promptExcerpt: "Prompt B",
        },
      },
    },
  });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_COMPLETED",
          lifecycleId: "life-a",
          sessionKey: "conversation:a",
          promptExcerpt: "Prompt A",
        },
      },
    },
  });
  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt A",
  });

  const diagnostics = context.sentMessages.filter((message) => message.type === "DIAGNOSTIC_EVENT");
  assert.deepEqual(diagnostics.map((message) => ({
    eventType: message.payload.eventType,
    flowId: message.payload.flowId,
    promptExcerpt: message.payload.promptExcerpt,
  })), [
    { eventType: "send_captured", flowId: "chatgpt:1780761600000:1", promptExcerpt: "" },
    { eventType: "lifecycle_started", flowId: "chatgpt:1780761600000:1", promptExcerpt: "Prompt A" },
    { eventType: "send_captured", flowId: "chatgpt:1780761600000:2", promptExcerpt: "" },
    { eventType: "lifecycle_started", flowId: "chatgpt:1780761600000:2", promptExcerpt: "Prompt B" },
    { eventType: "lifecycle_completed", flowId: "chatgpt:1780761600000:1", promptExcerpt: "Prompt A" },
  ]);
  assert.equal(context.sentMessages.at(-1).type, "AI_RESPONSE_COMPLETED");
  assert.equal(context.sentMessages.at(-1).payload.flowId, "chatgpt:1780761600000:1");
});

test("logs runtime response after sending completion message", () => {
  const logs = [];
  const context = createContentScriptContext({
    debugLogs: true,
    consoleApi: {
      info(prefix, message, detail) {
        logs.push({ prefix, message, detail });
      },
      warn() {},
      debug() {},
    },
  });

  context.getControllerOptions().onCompleted({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    promptExcerpt: "Prompt",
  });

  assert.deepEqual(logs.find((entry) => entry.message === "completion message acknowledged").detail, {
    ok: true,
    notificationId: "notification-id",
  });
});

test("forwards debug log state to the page lifecycle bridge", () => {
  const context = createContentScriptContext({
    consoleApi: {
      info() {},
      warn() {},
      debug() {},
    },
  });

  context.documentFixture.scripts[0].onload();
  context.storageChangeListeners[0]({ debugLogs: { newValue: true } }, "sync");

  const debugMessages = context.postedMessages.filter(
    (entry) => entry.message.type === "CHAT_NOTIFY_DEBUG_LOGS_CHANGED"
  );

  assert.deepEqual(debugMessages, [
    {
      message: {
        source: "chat-notify-content-script",
        type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
        debugLogs: false,
      },
      targetOrigin: "https://chatgpt.com",
    },
    {
      message: {
        source: "chat-notify-content-script",
        type: "CHAT_NOTIFY_DEBUG_LOGS_CHANGED",
        debugLogs: true,
      },
      targetOrigin: "https://chatgpt.com",
    },
  ]);
});

test("sends selected adapter lifecycle bridge config after bridge injection", async () => {
  const context = createContentScriptContext({
    enabled: true,
  });
  context.documentFixture.scripts[0].onload();

  const messages = context.postedMessages
    .map((entry) => entry.message)
    .filter((message) => message.type === "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].config.siteId, "chatgpt");
  assert.equal(messages[0].config.promptExtractor, "chatgpt");
});

test("registers Gemini adapter in content script", () => {
  const geminiAdapter = {
    siteId: "gemini",
    displayName: "Gemini",
    canObserveLifecycle: true,
    matchesLocation: (location) => location.hostname === "gemini.google.com",
    isSendEvent: () => false,
    normalizeLifecycleEvent: () => null,
    getLifecycleBridgeConfig: () => ({
      siteId: "gemini",
      hosts: ["gemini.google.com"],
      generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
      promptExtractor: "gemini",
    }),
  };
  const context = createContentScriptContext({
    supported: false,
    location: "https://gemini.google.com/app",
    extraApi: {
      createGeminiAdapter: () => geminiAdapter,
    },
  });

  assert.equal(context.adapter.siteId, "gemini");
});
