const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionTracker } = require("../src/core/session-tracker.js");

test("creates independent pending sessions", () => {
  const tracker = createSessionTracker({ now: () => 1000 });

  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    sourceTabId: 1,
    promptExcerpt: "A question",
  });

  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "conversation:b",
    sourceTabId: 2,
    promptExcerpt: "B question",
  });

  assert.equal(tracker.get("conversation:a").promptExcerpt, "A question");
  assert.equal(tracker.get("conversation:b").promptExcerpt, "B question");
  assert.equal(tracker.list().length, 2);
});

test("migrates a temporary session key to a stable conversation key", () => {
  const tracker = createSessionTracker({ now: () => 1000 });
  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "temp:1",
    sourceTabId: 4,
    promptExcerpt: "new chat",
  });

  const migrated = tracker.migrateSessionKey("temp:1", "conversation:stable");

  assert.equal(migrated, true);
  assert.equal(tracker.get("temp:1"), null);
  assert.equal(tracker.get("conversation:stable").promptExcerpt, "new chat");
});

test("clear removes prompt excerpt from memory", () => {
  const tracker = createSessionTracker({ now: () => 1000 });
  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    sourceTabId: 1,
    promptExcerpt: "sensitive",
  });

  const removed = tracker.remove("conversation:a");

  assert.equal(removed.promptExcerpt, "");
  assert.equal(tracker.get("conversation:a"), null);
});
