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

function createContentScriptContext({ enabled = true, supported = true } = {}) {
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, "utf8");
  const documentFixture = createFakeDocument();
  const sentMessages = [];
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
  };
  const api = {
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
  };
  const window = {
    location: new URL("https://chatgpt.com/c/test"),
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
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
      sendMessage(message) {
        sentMessages.push(message);
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
          callback({ enabled });
        },
      },
    },
  };
  const context = {
    ChatNotify: api,
    chrome,
    document: documentFixture.document,
    window,
    globalThis: null,
  };
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: CONTENT_SCRIPT_PATH });

  return {
    adapter,
    getControllerOptions: () => controllerOptions,
    controllerCalls,
    documentFixture,
    intervals,
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

test("does not install listeners when disabled", () => {
  const context = createContentScriptContext({ enabled: false });

  assert.equal(context.documentFixture.scripts.length, 0);
  assert.equal(context.documentFixture.listeners.size, 0);
  assert.equal(context.windowListeners.size, 0);
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
