const test = require("node:test");
const assert = require("node:assert/strict");
const { RESPONSE_STATES } = require("../src/shared/constants.js");
const { createResponseStateMachine } = require("../src/core/state-machine.js");

test("moves from idle to pending after user send", () => {
  const machine = createResponseStateMachine({ now: () => 1000 });
  const result = machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });

  assert.equal(result.state, RESPONSE_STATES.PENDING_USER_MESSAGE);
  assert.equal(result.shouldNotify, false);
});

test("moves pending to responding after lifecycle start", () => {
  const machine = createResponseStateMachine({ now: () => 1000 });
  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  const result = machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });

  assert.equal(result.state, RESPONSE_STATES.RESPONDING);
  assert.equal(result.lifecycleId, "life-1");
});

test("moves responding to completed after lifecycle complete and settle elapsed", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({
    now: () => currentTime,
    settleMs: 1800,
  });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  machine.transition({ type: "ASSISTANT_SNAPSHOT_CHANGED", snapshot: "hello" });
  currentTime = 3000;
  const settling = machine.transition({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });

  assert.equal(settling.state, RESPONSE_STATES.SETTLING);
  assert.equal(settling.shouldNotify, false);

  currentTime = 4800;
  const completed = machine.transition({ type: "TICK" });

  assert.equal(completed.state, RESPONSE_STATES.COMPLETED);
  assert.equal(completed.shouldNotify, true);
});

test("cancellation from responding never notifies", () => {
  const machine = createResponseStateMachine({ now: () => 1000 });
  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  const result = machine.transition({ type: "GENERATION_CANCELED", lifecycleId: "life-1" });

  assert.equal(result.state, RESPONSE_STATES.CANCELED);
  assert.equal(result.shouldNotify, false);
});

test("pending start timeout abandons without notification", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({
    now: () => currentTime,
    responseStartTimeoutMs: 30000,
  });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  currentTime = 32001;
  const result = machine.transition({ type: "TICK" });

  assert.equal(result.state, RESPONSE_STATES.ERROR_OR_UNKNOWN);
  assert.equal(result.shouldNotify, false);
});

test("completion notification is emitted once", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({ now: () => currentTime, settleMs: 10 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  machine.transition({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });
  currentTime = 1011;

  assert.equal(machine.transition({ type: "TICK" }).shouldNotify, true);
  assert.equal(machine.transition({ type: "TICK" }).shouldNotify, false);
});
