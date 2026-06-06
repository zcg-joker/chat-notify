const test = require("node:test");
const assert = require("node:assert/strict");
const { createResponseCompletedMessage } = require("../src/shared/messages.js");
const { createNotificationService } = require("../src/background/service-worker.js");

test("creates completion notification with prompt excerpt", async () => {
  const created = [];
  const service = createNotificationService({
    chromeApi: {
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
  assert.equal(created[0].options.title, "ChatGPT response complete");
  assert.equal(created[0].options.message, "\"Summarize this paper...\" is ready");
});

test("uses fallback notification message when excerpt is empty", async () => {
  const created = [];
  const service = createNotificationService({
    chromeApi: {
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
