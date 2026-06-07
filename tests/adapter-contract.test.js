const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAdapter,
  REQUIRED_ADAPTER_METHODS,
} = require("../src/adapters/adapter-contract.js");

test("adapter contract requires lifecycle bridge config", () => {
  assert.ok(REQUIRED_ADAPTER_METHODS.includes("getLifecycleBridgeConfig"));
});

test("rejects adapters missing lifecycle bridge config", () => {
  const adapter = {
    siteId: "example",
    displayName: "Example",
    canObserveLifecycle: true,
    matchesLocation: () => true,
    getSessionKey: () => "session",
    isSendEvent: () => false,
    getPromptDraft: () => "",
    getLatestUserMessage: () => "",
    isResponding: () => false,
    getLatestAssistantSnapshot: () => "",
    observePage: () => () => {},
    normalizeLifecycleEvent: () => null,
  };

  assert.equal(validateAdapter(adapter), false);
});
