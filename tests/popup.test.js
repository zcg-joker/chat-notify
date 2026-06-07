const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const POPUP_HTML_PATH = path.join(__dirname, "../src/popup/popup.html");
const POPUP_CSS_PATH = path.join(__dirname, "../src/popup/popup.css");
const POPUP_JS_PATH = path.join(__dirname, "../src/popup/popup.js");

function createElement(id) {
  const listeners = new Map();
  return {
    id,
    checked: false,
    className: "",
    disabled: false,
    textContent: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)();
    },
  };
}

function runPopup({
  enabled = true,
  debugLogs = false,
  tabUrl = "https://chatgpt.com/c/test",
  statusResponse = {
    ok: true,
    popupStatus: {
      notificationHealth: { state: "not_tested", message: "", updatedAt: null },
      lastCompletion: { state: "none", siteId: "", updatedAt: null },
    },
  },
  testNotificationResponse = { ok: true, notificationId: "test-id" },
  runtimeLastError = null,
} = {}) {
  const source = fs.readFileSync(POPUP_JS_PATH, "utf8");
  const elements = {
    "enabled-toggle": createElement("enabled-toggle"),
    "debug-logs-toggle": createElement("debug-logs-toggle"),
    "test-notification": createElement("test-notification"),
    "site-status": createElement("site-status"),
    "extension-status": createElement("extension-status"),
    "notification-status": createElement("notification-status"),
    "completion-status": createElement("completion-status"),
    "notification-detail": createElement("notification-detail"),
  };
  const storageWrites = [];
  const runtimeMessages = [];
  const context = {
    document: {
      getElementById(id) {
        return elements[id];
      },
    },
    chrome: {
      storage: {
        sync: {
          get(_defaults, callback) {
            callback({ enabled, debugLogs });
          },
          set(value) {
            storageWrites.push(value);
          },
        },
      },
      tabs: {
        query(_query, callback) {
          callback([{ url: tabUrl }]);
        },
      },
      runtime: {
        lastError: runtimeLastError,
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          if (message.type === "GET_POPUP_STATUS" && callback) {
            callback(statusResponse);
            return;
          }
          if (message.type === "TEST_NOTIFICATION" && callback) {
            callback(testNotificationResponse);
          }
        },
      },
    },
    ChatNotify: {
      MESSAGE_TYPES: {
        GET_POPUP_STATUS: "GET_POPUP_STATUS",
        TEST_NOTIFICATION: "TEST_NOTIFICATION",
      },
      createTestNotificationMessage() {
        return { type: "TEST_NOTIFICATION", payload: {} };
      },
    },
    URL,
  };

  vm.runInNewContext(source, context, { filename: POPUP_JS_PATH });

  return {
    elements,
    runtimeMessages,
    storageWrites,
  };
}

test("popup assets exist and reference expected scripts", () => {
  const html = fs.readFileSync(POPUP_HTML_PATH, "utf8");
  const css = fs.readFileSync(POPUP_CSS_PATH, "utf8");

  assert.match(html, /id="enabled-toggle"/);
  assert.match(html, /id="debug-logs-toggle"/);
  assert.match(html, /id="test-notification"/);
  assert.match(html, /id="site-status"/);
  assert.match(html, /id="extension-status"/);
  assert.match(html, /id="notification-status"/);
  assert.match(html, /id="notification-detail"/);
  assert.match(html, /id="completion-status"/);
  assert.match(html, /src="\.\.\/shared\/messages\.js"/);
  assert.match(html, /src="\.\/popup\.js"/);
  assert.match(css, /\.popup/);
});

test("popup initializes stored toggle states and supported site status", () => {
  const popup = runPopup({
    enabled: false,
    debugLogs: true,
    tabUrl: "https://chatgpt.com/c/test",
  });

  assert.equal(popup.elements["enabled-toggle"].checked, false);
  assert.equal(popup.elements["debug-logs-toggle"].checked, true);
  assert.equal(popup.elements["extension-status"].textContent, "Disabled");
  assert.equal(popup.elements["site-status"].textContent, "Current page is supported");
});

test("popup stores toggle changes and sends test notification message", () => {
  const popup = runPopup({ enabled: true, tabUrl: "https://example.com/" });

  popup.elements["enabled-toggle"].checked = false;
  popup.elements["enabled-toggle"].dispatch("change");
  popup.elements["debug-logs-toggle"].checked = true;
  popup.elements["debug-logs-toggle"].dispatch("change");
  popup.elements["test-notification"].dispatch("click");

  assert.equal(popup.elements["site-status"].textContent, "Current page is not supported");
  assert.equal(popup.storageWrites.length, 2);
  assert.equal(popup.storageWrites[0].enabled, false);
  assert.equal(popup.storageWrites[1].debugLogs, true);
  assert.equal(popup.runtimeMessages.length, 2);
  assert.equal(popup.runtimeMessages[0].type, "GET_POPUP_STATUS");
  assert.equal(popup.runtimeMessages[1].type, "TEST_NOTIFICATION");
});

test("popup updates extension status when enabled toggle changes", () => {
  const popup = runPopup({ enabled: true });

  assert.equal(popup.elements["extension-status"].textContent, "Enabled");

  popup.elements["enabled-toggle"].checked = false;
  popup.elements["enabled-toggle"].dispatch("change");

  assert.equal(popup.elements["extension-status"].textContent, "Disabled");
});

test("popup renders background status summaries for working notifications and sent completion", () => {
  const popup = runPopup({
    enabled: true,
    statusResponse: {
      ok: true,
      popupStatus: {
        notificationHealth: { state: "working", message: "", updatedAt: 1780761600000 },
        lastCompletion: { state: "sent", siteId: "chatgpt", updatedAt: 1780761600000 },
      },
    },
  });

  assert.equal(popup.elements["extension-status"].textContent, "Enabled");
  assert.equal(popup.elements["notification-status"].textContent, "Notifications working");
  assert.equal(popup.elements["notification-detail"].textContent, "");
  assert.equal(popup.elements["completion-status"].textContent, "Last notification sent");
});

test("popup shows test notification failure response and detail", () => {
  const popup = runPopup({
    testNotificationResponse: {
      ok: false,
      error: "notifications permission missing",
      notificationId: "test-id",
    },
  });

  popup.elements["test-notification"].dispatch("click");

  assert.equal(popup.elements["notification-status"].textContent, "Notification failed");
  assert.equal(popup.elements["notification-detail"].textContent, "notifications permission missing");
});
