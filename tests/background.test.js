const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
  createResponseCompletedMessage,
  createTestNotificationMessage,
} = require("../src/shared/messages.js");
const { createNotificationService } = require("../src/background/service-worker.js");

const DEFAULT_POPUP_STATUS = {
  notificationHealth: { state: "not_tested", message: "", updatedAt: null },
  lastCompletion: { state: "none", siteId: "", updatedAt: null },
};

function createFakeStorageArea(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    data,
    get(defaults, callback) {
      if (typeof defaults === "string") {
        callback({ [defaults]: data[defaults] });
        return;
      }
      if (Array.isArray(defaults)) {
        callback(defaults.reduce((result, key) => {
          result[key] = data[key];
          return result;
        }, {}));
        return;
      }
      const values = Object.assign({}, defaults || {});
      Object.keys(values).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          values[key] = data[key];
        }
      });
      callback(values);
    },
    set(values, callback) {
      Object.assign(data, values);
      if (callback) {
        callback();
      }
    },
  };
}

function createFailingStorageArea(chromeApi, mode = "lastError") {
  return {
    get(_defaults, callback) {
      if (mode === "throw") {
        throw new Error("storage get failed");
      }
      chromeApi.runtime.lastError = { message: "storage get failed" };
      callback({});
    },
    set(_values, callback) {
      if (mode === "throw") {
        throw new Error("storage set failed");
      }
      chromeApi.runtime.lastError = { message: "storage set failed" };
      callback();
    },
  };
}

function createSetFailingStorageArea(chromeApi, getValues = {}) {
  return {
    setAttempts: [],
    get(defaults, callback) {
      callback(Object.assign({}, defaults || {}, getValues));
    },
    set(values, callback) {
      this.setAttempts.push(values);
      chromeApi.runtime.lastError = { message: "storage set failed" };
      callback();
    },
  };
}

function createDelayedStorageArea() {
  const data = {};
  const pendingGets = [];
  const pendingSets = [];
  return {
    data,
    get(defaults, callback) {
      const snapshot = Object.assign({}, defaults || {});
      Object.keys(data).forEach((key) => {
        snapshot[key] = data[key];
      });
      pendingGets.push(() => callback(snapshot));
    },
    set(values, callback) {
      pendingSets.push(() => {
        Object.assign(data, values);
        callback();
      });
    },
    flushNextGet() {
      pendingGets.shift()();
    },
    flushNextSet() {
      pendingSets.shift()();
    },
    get pendingGetCount() {
      return pendingGets.length;
    },
    get pendingSetCount() {
      return pendingSets.length;
    },
  };
}

test("creates completion notification with prompt excerpt", async () => {
  const created = [];
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, options, callback) {
          created.push({ id, options });
          callback("notification-id");
        },
      },
      storage: { local, session },
    },
    now: () => 1780761600000,
  });

  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:a",
    sourceTabId: 3,
    promptExcerpt: "Summarize this paper...",
    completedAt: 1780761600000,
  });

  const result = await service.handleMessage(message, { tab: { id: 3, windowId: 9 } });

  assert.equal(result.ok, true);
  assert.match(created[0].id, /^chat-notify:chatgpt:3:1780761600000:\d+$/);
  assert.equal(created[0].id.includes("conversation:a"), false);
  assert.equal(created[0].options.iconUrl, "chrome-extension://test/assets/icon-128.png");
  assert.equal(created[0].options.title, "ChatGPT response complete");
  assert.equal(created[0].options.message, "\"Summarize this paper...\" is ready");
  assert.deepEqual(session.data.notificationTargets[result.notificationId], {
    notificationId: result.notificationId,
    tabId: 3,
    windowId: 9,
    createdAt: 1780761600000,
  });
  assert.equal(JSON.stringify(session.data.notificationTargets).includes("conversation:a"), false);
  assert.equal(JSON.stringify(session.data.notificationTargets).includes("Summarize this paper"), false);
  assert.deepEqual(local.data.popupStatus.lastCompletion, {
    state: "sent",
    siteId: "chatgpt",
    updatedAt: 1780761600000,
  });
  assert.deepEqual(local.data.popupStatus.notificationHealth, DEFAULT_POPUP_STATUS.notificationHealth);
});

test("uses fallback notification message when excerpt is empty", async () => {
  const created = [];
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, options, callback) {
          created.push({ id, options });
          callback("notification-id");
        },
      },
    },
    now: () => 1780761600000,
  });

  await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3 } }
  );

  assert.equal(created[0].options.message, "Your response is ready");
});

test("does not create completion notifications when disabled in storage", async () => {
  const service = createNotificationService({
    chromeApi: {
      storage: {
        sync: {
          get(_defaults, callback) {
            callback({ enabled: false });
          },
        },
      },
      notifications: {
        create() {
          throw new Error("should not notify while disabled");
        },
      },
    },
  });

  const result = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
    })
  );

  assert.deepEqual(result, { ok: false, ignored: true, disabled: true });
});

test("creates test notification", async () => {
  const created = [];
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, options, callback) {
          created.push({ id, options });
          callback("notification-id");
        },
      },
      storage: { local, session },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(createTestNotificationMessage());

  assert.equal(result.ok, true);
  assert.match(result.notificationId, /^chat-notify:test:/);
  assert.equal(created[0].options.iconUrl, "chrome-extension://test/assets/icon-128.png");
  assert.equal(created[0].options.title, "Chat Notify test");
  assert.equal(created[0].options.message, "Notifications are working");
  assert.deepEqual(session.data.notificationTargets, undefined);
  assert.deepEqual(local.data.popupStatus.notificationHealth, {
    state: "ok",
    message: "",
    updatedAt: 1780761600000,
  });
  assert.deepEqual(local.data.popupStatus.lastCompletion, DEFAULT_POPUP_STATUS.lastCompletion);
});

test("writes background logs only when debug logs are enabled", async () => {
  const logs = [];
  const originalConsole = globalThis.console;
  globalThis.console = {
    info(prefix, message, detail) {
      logs.push({ level: "info", prefix, message, detail });
    },
    warn(prefix, message, detail) {
      logs.push({ level: "warn", prefix, message, detail });
    },
    debug(prefix, message, detail) {
      logs.push({ level: "debug", prefix, message, detail });
    },
  };

  try {
    const createService = (debugLogs) => createNotificationService({
      chromeApi: {
        storage: {
          sync: {
            get(defaults, callback) {
              callback(Object.assign({}, defaults, { enabled: true, debugLogs }));
            },
          },
        },
        runtime: {
          getURL(path) {
            return `chrome-extension://test/${path}`;
          },
        },
        notifications: {
          create(id, _options, callback) {
            callback(id);
          },
        },
      },
      now: () => 1780761600000,
    });

    await createService(false).handleMessage(createTestNotificationMessage());
    assert.deepEqual(logs, []);

    await createService(true).handleMessage(createTestNotificationMessage());
    assert.deepEqual(
      logs.map((entry) => entry.message),
      ["background message received", "test notification created"]
    );
  } finally {
    globalThis.console = originalConsole;
  }
});

test("ignores non-completion messages", async () => {
  const service = createNotificationService({
    chromeApi: {
      notifications: {
        create() {
          throw new Error("should not notify");
        },
      },
    },
  });

  const result = await service.handleMessage({ type: "SOMETHING_ELSE" });

  assert.deepEqual(result, { ok: false, ignored: true });
});

test("returns failure when Chrome reports notification error", async () => {
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        lastError: { message: "notifications permission missing" },
      },
      notifications: {
        create(id, options, callback) {
          callback("");
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "notifications permission missing");
});

test("returns failure when notification API throws", async () => {
  const service = createNotificationService({
    chromeApi: {
      notifications: {
        create() {
          throw new Error("notification API unavailable");
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "notification API unavailable");
});

test("returns default popup status when none is stored", async () => {
  const local = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      storage: { local },
    },
  });

  const result = await service.handleMessage({ type: MESSAGE_TYPES.GET_POPUP_STATUS });

  assert.deepEqual(result, { ok: true, popupStatus: DEFAULT_POPUP_STATUS });
});

test("popup status falls back to memory when local storage fails", async () => {
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
    notifications: {
      create(id, _options, callback) {
        callback(id);
      },
    },
    storage: {},
  };
  chromeApi.storage.local = createFailingStorageArea(chromeApi);
  const service = createNotificationService({
    chromeApi,
    now: () => 1780761600000,
  });

  const testResult = await service.handleMessage(createTestNotificationMessage());
  const statusResult = await service.handleMessage({ type: MESSAGE_TYPES.GET_POPUP_STATUS });

  assert.equal(testResult.ok, true);
  assert.deepEqual(statusResult, {
    ok: true,
    popupStatus: {
      notificationHealth: {
        state: "ok",
        message: "",
        updatedAt: 1780761600000,
      },
      lastCompletion: DEFAULT_POPUP_STATUS.lastCompletion,
    },
  });
});

test("popup status prefers memory after local storage set fails", async () => {
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
    notifications: {
      create(id, _options, callback) {
        callback(id);
      },
    },
    storage: {},
  };
  chromeApi.storage.local = createSetFailingStorageArea(chromeApi, {
    popupStatus: DEFAULT_POPUP_STATUS,
  });
  const service = createNotificationService({
    chromeApi,
    now: () => 1780761600000,
  });

  const testResult = await service.handleMessage(createTestNotificationMessage());
  const statusResult = await service.handleMessage({ type: MESSAGE_TYPES.GET_POPUP_STATUS });

  assert.equal(testResult.ok, true);
  assert.deepEqual(statusResult.popupStatus.notificationHealth, {
    state: "ok",
    message: "",
    updatedAt: 1780761600000,
  });
  assert.equal(chromeApi.storage.local.setAttempts.length, 1);
});

test("clicking bound notification focuses source window and tab then clears target", async () => {
  const updates = [];
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, _options, callback) {
          callback(id);
        },
      },
      storage: { local, session },
      windows: {
        update(windowId, options, callback) {
          updates.push({ type: "window", windowId, options });
          callback({ id: windowId });
        },
      },
      tabs: {
        update(tabId, options, callback) {
          updates.push({ type: "tab", tabId, options });
          callback({ id: tabId });
        },
      },
    },
    now: () => 1780761600000,
  });

  const sent = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );

  const result = await service.handleNotificationClicked(sent.notificationId);

  assert.deepEqual(result, { ok: true, focused: true });
  assert.deepEqual(updates, [
    { type: "window", windowId: 9, options: { focused: true } },
    { type: "tab", tabId: 3, options: { active: true } },
  ]);
  assert.deepEqual(session.data.notificationTargets, {});
});

test("immediate notification click can use pre-stored completion target", async () => {
  const updates = [];
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  let service;
  let clickedDuringCreate;
  service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, _options, callback) {
          clickedDuringCreate = service.handleNotificationClicked(id);
          callback(id);
        },
      },
      storage: { local, session },
      windows: {
        update(windowId, options, callback) {
          updates.push({ type: "window", windowId, options });
          callback({ id: windowId });
        },
      },
      tabs: {
        update(tabId, options, callback) {
          updates.push({ type: "tab", tabId, options });
          callback({ id: tabId });
        },
      },
    },
    now: () => 1780761600000,
  });

  const sent = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );

  assert.equal(sent.ok, true);
  assert.deepEqual(await clickedDuringCreate, { ok: true, focused: true });
  assert.deepEqual(updates, [
    { type: "window", windowId: 9, options: { focused: true } },
    { type: "tab", tabId: 3, options: { active: true } },
  ]);
  assert.deepEqual(session.data.notificationTargets, {});
});

test("completion notification create failure clears pre-stored target", async () => {
  const local = createFakeStorageArea();
  const session = createFakeStorageArea();
  const chromeApi = {
    runtime: {},
    storage: { local, session },
    notifications: {
      create(_id, _options, callback) {
        chromeApi.runtime.lastError = { message: "notifications permission missing" };
        callback("");
      },
    },
  };
  const service = createNotificationService({
    chromeApi,
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(session.data.notificationTargets, {});
});

test("notification targets fall back to memory when session storage fails", async () => {
  const updates = [];
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
    notifications: {
      create(id, _options, callback) {
        callback(id);
      },
    },
    storage: {
      local: createFakeStorageArea(),
    },
    windows: {
      update(windowId, options, callback) {
        updates.push({ type: "window", windowId, options });
        callback({ id: windowId });
      },
    },
    tabs: {
      update(tabId, options, callback) {
        updates.push({ type: "tab", tabId, options });
        callback({ id: tabId });
      },
    },
  };
  chromeApi.storage.session = createFailingStorageArea(chromeApi);
  const service = createNotificationService({
    chromeApi,
    now: () => 1780761600000,
  });

  const sent = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );
  const clicked = await service.handleNotificationClicked(sent.notificationId);
  const secondClick = await service.handleNotificationClicked(sent.notificationId);

  assert.equal(sent.ok, true);
  assert.deepEqual(clicked, { ok: true, focused: true });
  assert.deepEqual(secondClick, { ok: false, ignored: true });
  assert.deepEqual(updates, [
    { type: "window", windowId: 9, options: { focused: true } },
    { type: "tab", tabId: 3, options: { active: true } },
  ]);
});

test("notification targets prefer memory after session storage set fails", async () => {
  const updates = [];
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
    notifications: {
      create(id, _options, callback) {
        callback(id);
      },
    },
    storage: {
      local: createFakeStorageArea(),
    },
    windows: {
      update(windowId, options, callback) {
        updates.push({ type: "window", windowId, options });
        callback({ id: windowId });
      },
    },
    tabs: {
      update(tabId, options, callback) {
        updates.push({ type: "tab", tabId, options });
        callback({ id: tabId });
      },
    },
  };
  chromeApi.storage.session = createSetFailingStorageArea(chromeApi, {
    notificationTargets: {},
  });
  const service = createNotificationService({
    chromeApi,
    now: () => 1780761600000,
  });

  const sent = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "hello",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );
  const clicked = await service.handleNotificationClicked(sent.notificationId);
  const secondClick = await service.handleNotificationClicked(sent.notificationId);

  assert.equal(sent.ok, true);
  assert.deepEqual(clicked, { ok: true, focused: true });
  assert.deepEqual(secondClick, { ok: false, ignored: true });
  assert.deepEqual(updates, [
    { type: "window", windowId: 9, options: { focused: true } },
    { type: "tab", tabId: 3, options: { active: true } },
  ]);
  assert.equal(chromeApi.storage.session.setAttempts.length, 2);
});

test("concurrent completion notifications preserve both click targets", async () => {
  const updates = [];
  const session = createDelayedStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
      },
      notifications: {
        create(id, _options, callback) {
          callback(id);
        },
      },
      storage: {
        local: createFakeStorageArea(),
        session,
      },
      windows: {
        update(windowId, options, callback) {
          updates.push({ type: "window", windowId, options });
          callback({ id: windowId });
        },
      },
      tabs: {
        update(tabId, options, callback) {
          updates.push({ type: "tab", tabId, options });
          callback({ id: tabId });
        },
      },
    },
    now: () => 1780761600000,
  });

  const first = service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "first",
      completedAt: 1780761600000,
    }),
    { tab: { id: 3, windowId: 9 } }
  );
  const second = service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:b",
      sourceTabId: 4,
      promptExcerpt: "second",
      completedAt: 1780761600000,
    }),
    { tab: { id: 4, windowId: 9 } }
  );

  for (let attempt = 0; attempt < 20 && session.pendingGetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingGetCount, 1);
  session.flushNextGet();
  for (let attempt = 0; attempt < 20 && session.pendingSetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingSetCount, 1);
  session.flushNextSet();
  for (let attempt = 0; attempt < 20 && session.pendingGetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingGetCount, 1);
  session.flushNextGet();
  for (let attempt = 0; attempt < 20 && session.pendingSetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingSetCount, 1);
  session.flushNextSet();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual(Object.keys(session.data.notificationTargets).sort(), [
    firstResult.notificationId,
    secondResult.notificationId,
  ].sort());

  const clickResult = service.handleNotificationClicked(firstResult.notificationId);
  for (let attempt = 0; attempt < 20 && session.pendingGetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingGetCount, 1);
  session.flushNextGet();
  for (let attempt = 0; attempt < 20 && session.pendingGetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingGetCount, 1);
  session.flushNextGet();
  for (let attempt = 0; attempt < 20 && session.pendingSetCount < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(session.pendingSetCount, 1);
  session.flushNextSet();

  assert.deepEqual(await clickResult, { ok: true, focused: true });
  assert.equal(session.data.notificationTargets[firstResult.notificationId], undefined);
  assert.deepEqual(session.data.notificationTargets[secondResult.notificationId], {
    notificationId: secondResult.notificationId,
    tabId: 4,
    windowId: 9,
    createdAt: 1780761600000,
  });
  assert.deepEqual(updates, [
    { type: "window", windowId: 9, options: { focused: true } },
    { type: "tab", tabId: 3, options: { active: true } },
  ]);
});

test("clicking unknown notification is ignored", async () => {
  const session = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      storage: { session },
      windows: {
        update() {
          throw new Error("should not focus window");
        },
      },
      tabs: {
        update() {
          throw new Error("should not focus tab");
        },
      },
    },
  });

  const result = await service.handleNotificationClicked("missing");

  assert.deepEqual(result, { ok: false, ignored: true });
});

test("completion notification failure updates last completion as failed", async () => {
  const local = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        lastError: { message: "notifications permission missing" },
      },
      storage: { local },
      notifications: {
        create(_id, _options, callback) {
          callback("");
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(
    createResponseCompletedMessage({
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:a",
      sourceTabId: 3,
      promptExcerpt: "secret prompt",
      completedAt: 1780761600000,
    })
  );

  assert.equal(result.ok, false);
  assert.deepEqual(local.data.popupStatus.lastCompletion, {
    state: "failed",
    siteId: "chatgpt",
    updatedAt: 1780761600000,
  });
  assert.equal(JSON.stringify(local.data.popupStatus).includes("secret prompt"), false);
  assert.equal(JSON.stringify(local.data.popupStatus).includes("conversation:a"), false);
});

test("test notification failure updates notification health as failed", async () => {
  const local = createFakeStorageArea();
  const service = createNotificationService({
    chromeApi: {
      runtime: {
        lastError: { message: "notifications permission missing" },
      },
      storage: { local },
      notifications: {
        create(_id, _options, callback) {
          callback("");
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(createTestNotificationMessage());

  assert.equal(result.ok, false);
  assert.deepEqual(local.data.popupStatus.notificationHealth, {
    state: "failed",
    message: "notifications permission missing",
    updatedAt: 1780761600000,
  });
});

test("notification click failures do not throw and clear target", async () => {
  const session = createFakeStorageArea({
    notificationTargets: {
      "bound-id": {
        notificationId: "bound-id",
        tabId: 3,
        windowId: 9,
        createdAt: 1780761600000,
      },
    },
  });
  let callCount = 0;
  const chromeApi = {
    runtime: {},
    storage: { session },
    windows: {
      update(_windowId, _options, callback) {
        callCount += 1;
        chromeApi.runtime.lastError = { message: "No window with id: 9" };
        callback();
      },
    },
    tabs: {
      update(_tabId, _options, callback) {
        callCount += 1;
        chromeApi.runtime.lastError = { message: "No tab with id: 3" };
        callback();
      },
    },
  };
  const service = createNotificationService({ chromeApi });

  const result = await service.handleNotificationClicked("bound-id");

  assert.equal(result.ok, false);
  assert.equal(result.focused, false);
  assert.equal(result.cleared, true);
  assert.equal(callCount >= 1, true);
  assert.deepEqual(session.data.notificationTargets, {});
});

test("extension bootstrap registers notification click listener", async () => {
  const serviceWorkerPath = require.resolve("../src/background/service-worker.js");
  const originalChrome = globalThis.chrome;
  const originalChatNotify = globalThis.ChatNotify;
  const listeners = [];

  delete require.cache[serviceWorkerPath];
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener() {},
      },
    },
    storage: {
      session: createFakeStorageArea(),
      sync: createFakeStorageArea({ debugLogs: false }),
    },
    notifications: {
      onClicked: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
    tabs: {
      update() {
        throw new Error("unknown click should not update tab");
      },
    },
  };

  try {
    require("../src/background/service-worker.js");
    assert.equal(listeners.length, 1);
    listeners[0]("unknown-notification");
  } finally {
    delete require.cache[serviceWorkerPath];
    globalThis.chrome = originalChrome;
    globalThis.ChatNotify = originalChatNotify;
    require("../src/background/service-worker.js");
  }
});
