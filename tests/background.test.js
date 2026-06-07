const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createResponseCompletedMessage,
  createTestNotificationMessage,
} = require("../src/shared/messages.js");
const { createNotificationService } = require("../src/background/service-worker.js");

test("creates completion notification with prompt excerpt", async () => {
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

  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:a",
    sourceTabId: 3,
    promptExcerpt: "Summarize this paper...",
    completedAt: 1780761600000,
  });

  const result = await service.handleMessage(message, { tab: { id: 3 } });

  assert.equal(result.ok, true);
  assert.match(created[0].id, /^chat-notify:chatgpt:conversation:a:3:/);
  assert.equal(created[0].options.iconUrl, "chrome-extension://test/assets/icon-128.png");
  assert.equal(created[0].options.title, "ChatGPT response complete");
  assert.equal(created[0].options.message, "\"Summarize this paper...\" is ready");
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

  const result = await service.handleMessage(createTestNotificationMessage());

  assert.equal(result.ok, true);
  assert.match(result.notificationId, /^chat-notify:test:/);
  assert.equal(created[0].options.iconUrl, "chrome-extension://test/assets/icon-128.png");
  assert.equal(created[0].options.title, "Chat Notify test");
  assert.equal(created[0].options.message, "Notifications are working");
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
