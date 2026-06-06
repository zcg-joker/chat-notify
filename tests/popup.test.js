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
    textContent: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)();
    },
  };
}

function runPopup({ enabled = true, tabUrl = "https://chatgpt.com/c/test" } = {}) {
  const source = fs.readFileSync(POPUP_JS_PATH, "utf8");
  const elements = {
    "enabled-toggle": createElement("enabled-toggle"),
    "test-notification": createElement("test-notification"),
    "site-status": createElement("site-status"),
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
            callback({ enabled });
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
        sendMessage(message) {
          runtimeMessages.push(message);
        },
      },
    },
    ChatNotify: {
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
  assert.match(html, /id="test-notification"/);
  assert.match(html, /src="\.\.\/shared\/messages\.js"/);
  assert.match(html, /src="\.\/popup\.js"/);
  assert.match(css, /\.popup/);
});

test("popup initializes enabled state and supported site status", () => {
  const popup = runPopup({ enabled: false, tabUrl: "https://chatgpt.com/c/test" });

  assert.equal(popup.elements["enabled-toggle"].checked, false);
  assert.equal(popup.elements["site-status"].textContent, "Current page is supported");
});

test("popup stores toggle changes and sends test notification message", () => {
  const popup = runPopup({ enabled: true, tabUrl: "https://example.com/" });

  popup.elements["enabled-toggle"].checked = false;
  popup.elements["enabled-toggle"].dispatch("change");
  popup.elements["test-notification"].dispatch("click");

  assert.equal(popup.elements["site-status"].textContent, "Current page is not supported");
  assert.equal(popup.storageWrites.length, 1);
  assert.equal(popup.storageWrites[0].enabled, false);
  assert.equal(popup.runtimeMessages.length, 1);
  assert.equal(popup.runtimeMessages[0].type, "TEST_NOTIFICATION");
});
