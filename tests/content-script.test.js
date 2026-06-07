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
  location = "https://chatgpt.com/c/test",
  extraApi = {},
  consoleApi = console,
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
  const api = Object.assign({
    createChatGptAdapter: () => adapter,
    createMonitorController: (options) => {
      controllerOptions = options;
      return {
        handleUserSend() {
          controllerCalls.handleUserSend += 1;
        },
        handleLifecycleEvent(event) {
          controllerCalls.handleLifecycleEvent.push(event);
        },
        tick() {
          controllerCalls.tick += 1;
        },
      };
    },
    createResponseCompletedMessage: (event) => ({ type: "AI_RESPONSE_COMPLETED", payload: event }),
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
    globalThis: null,
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: CONTENT_SCRIPT_PATH });

  return {
    adapter: controllerOptions && controllerOptions.adapter,
    getControllerOptions: () => controllerOptions,
    controllerCalls,
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

  assert.deepEqual(context.sentMessages, [
    {
      type: "AI_RESPONSE_COMPLETED",
      payload: {
        siteId: "chatgpt",
        sessionKey: "conversation:a",
        promptExcerpt: "Prompt",
      },
    },
  ]);
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
