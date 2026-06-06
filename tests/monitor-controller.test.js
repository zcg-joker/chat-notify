const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitorController } = require("../src/core/monitor-controller.js");

function createFakeAdapter(state) {
  return {
    siteId: "chatgpt",
    displayName: "ChatGPT",
    getSessionKey: () => state.sessionKey,
    getPromptDraft: () => state.promptDraft,
    getLatestUserMessage: () => state.latestUserMessage || "",
    getLatestAssistantSnapshot: () => state.latestAssistantSnapshot || "",
    isResponding: () => Boolean(state.responding),
  };
}

test("emits completion once for a session lifecycle", () => {
  let currentTime = 1000;
  const completed = [];
  const adapter = {
    siteId: "chatgpt",
    displayName: "ChatGPT",
    getSessionKey: () => "conversation:a",
    getPromptDraft: () => "Summarize this paper in three bullets",
    getLatestUserMessage: () => "",
    getLatestAssistantSnapshot: () => "Done",
    isResponding: () => false,
  };

  const controller = createMonitorController({
    adapter,
    root: {},
    sourceTabId: 7,
    now: () => currentTime,
    onCompleted: (event) => completed.push(event),
    settleMs: 10,
  });

  controller.handleUserSend();
  controller.handleLifecycleEvent({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  controller.handleLifecycleEvent({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });
  currentTime = 1011;
  controller.tick();
  controller.tick();

  assert.equal(completed.length, 1);
  assert.equal(completed[0].sessionKey, "conversation:a");
  assert.equal(completed[0].promptExcerpt, "Summarize this paper in three bullets");
});

test("canceled lifecycle does not emit completion and clears pending session", () => {
  const completed = [];
  const adapter = {
    siteId: "chatgpt",
    displayName: "ChatGPT",
    getSessionKey: () => "conversation:a",
    getPromptDraft: () => "A prompt",
    getLatestUserMessage: () => "",
    getLatestAssistantSnapshot: () => "",
    isResponding: () => false,
  };

  const controller = createMonitorController({
    adapter,
    root: {},
    sourceTabId: 7,
    now: () => 1000,
    onCompleted: (event) => completed.push(event),
  });

  controller.handleUserSend();
  controller.handleLifecycleEvent({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  controller.handleLifecycleEvent({ type: "GENERATION_CANCELED", lifecycleId: "life-1" });

  assert.equal(completed.length, 0);
  assert.equal(controller.getPendingSessions().length, 0);
});

test("routes known lifecycle events to the original same-tab session after switching sessions", () => {
  let currentTime = 1000;
  const completed = [];
  const adapterState = {
    sessionKey: "conversation:a",
    promptDraft: "Prompt for session A",
  };
  const controller = createMonitorController({
    adapter: createFakeAdapter(adapterState),
    root: {},
    sourceTabId: 7,
    now: () => currentTime,
    onCompleted: (event) => completed.push(event),
    settleMs: 10,
  });

  controller.handleUserSend();
  controller.handleLifecycleEvent({ type: "GENERATION_STARTED", lifecycleId: "life-a" });

  adapterState.sessionKey = "conversation:b";
  adapterState.promptDraft = "Prompt for session B";
  controller.handleUserSend();
  controller.handleLifecycleEvent({ type: "GENERATION_STARTED", lifecycleId: "life-b" });

  controller.handleLifecycleEvent({ type: "GENERATION_COMPLETED", lifecycleId: "life-a" });
  currentTime = 1011;
  controller.tick();

  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0], {
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:a",
    sourceTabId: 7,
    promptExcerpt: "Prompt for session A",
    completedAt: 1011,
  });
  assert.deepEqual(
    controller.getPendingSessions().map((session) => session.sessionKey),
    ["conversation:b"]
  );
});

test("associates an unmapped lifecycle with the first pending user message session", () => {
  const adapterState = {
    sessionKey: "conversation:a",
    promptDraft: "Prompt for session A",
  };
  const controller = createMonitorController({
    adapter: createFakeAdapter(adapterState),
    root: {},
    sourceTabId: 7,
    now: () => 1000,
    onCompleted: () => {},
  });

  controller.handleUserSend();
  adapterState.sessionKey = "conversation:b";
  adapterState.promptDraft = "Prompt for session B";
  controller.handleUserSend();

  controller.handleLifecycleEvent({ type: "GENERATION_STARTED", lifecycleId: "life-a" });

  const pendingSessions = controller.getPendingSessions();
  assert.equal(pendingSessions.find((session) => session.sessionKey === "conversation:a").lifecycleId, "life-a");
  assert.equal(pendingSessions.find((session) => session.sessionKey === "conversation:b").lifecycleId, "");
});
