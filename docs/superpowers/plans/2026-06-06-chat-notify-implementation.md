# Chat Notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chat Notify MVP as a Manifest V3 browser extension that monitors ChatGPT responses by session and sends local browser notifications when user-initiated responses complete.

**Architecture:** The extension uses plain JavaScript with no build step. Browser scripts expose focused modules through `globalThis.ChatNotify`, and the same modules export CommonJS objects for Node's built-in test runner. Session-scoped monitoring is handled by pure core modules, while ChatGPT-specific DOM and request-lifecycle behavior stays inside the adapter and page lifecycle bridge.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, CommonJS-compatible UMD modules, Node `node:test`, `chrome.notifications`, `chrome.storage`, content scripts, injected page-context bridge.

---

## File Structure

Create these files:

- `package.json`: Node test scripts and project metadata.
- `.gitignore`: Excludes dependency folders, logs, and local browser artifacts.
- `manifest.json`: Manifest V3 extension declaration.
- `README.md`: Open-source project overview, install steps, privacy notes, manual validation checklist.
- `assets/icon.svg`: Extension and notification icon.
- `src/shared/constants.js`: Shared states, default timing, storage keys, site IDs.
- `src/shared/messages.js`: Extension message names and message builders.
- `src/core/prompt-excerpt.js`: Prompt normalization and truncation.
- `src/core/state-machine.js`: Pure state transition logic for one pending response.
- `src/core/session-tracker.js`: In-memory `pendingSessions` map and temp-to-stable session migration.
- `src/core/dom-watch.js`: Small DOM observer helper used by monitor and adapter.
- `src/core/monitor-controller.js`: Orchestrates adapter events, lifecycle events, state machine, and completion emission.
- `src/adapters/adapter-contract.js`: Runtime contract validator and adapter documentation object.
- `src/adapters/chatgpt-adapter.js`: ChatGPT URL matching, session key extraction, send detection, visible DOM state detection, lifecycle normalization.
- `src/content/page-lifecycle-bridge.js`: Injected page-context fetch lifecycle bridge.
- `src/content/content-script.js`: Content script entry point, adapter registry, bridge installation, monitor startup.
- `src/background/service-worker.js`: Notification service worker and popup message handling.
- `src/popup/popup.html`: Minimal popup UI.
- `src/popup/popup.css`: Popup styling.
- `src/popup/popup.js`: Enabled setting, supported-site display, test notification request.
- `tests/prompt-excerpt.test.js`: Unit tests for prompt excerpts.
- `tests/state-machine.test.js`: Unit tests for state transitions.
- `tests/session-tracker.test.js`: Unit tests for session tracking.
- `tests/messages.test.js`: Unit tests for message builders.
- `tests/chatgpt-adapter.test.js`: Unit tests for URL/session/lifecycle normalization logic.
- `tests/manifest.test.js`: Smoke tests for extension permissions and script declarations.
- `tests/background.test.js`: Unit tests for notification payload creation using a fake `chrome` object.
- `tests/monitor-controller.test.js`: Unit tests for session-scoped completion orchestration with a fake adapter and fake timers.

The first implementation should not create a build pipeline. All extension scripts must be loadable directly by Chrome.

---

### Task 1: Project Harness And Shared Constants

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/shared/constants.js`
- Create: `src/shared/messages.js`
- Create: `tests/messages.test.js`

- [ ] **Step 1: Write message builder tests**

Create `tests/messages.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MESSAGE_TYPES,
  createResponseCompletedMessage,
  createTestNotificationMessage,
} = require("../src/shared/messages.js");

test("createResponseCompletedMessage creates a sanitized completion event", () => {
  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:abc",
    sourceTabId: 12,
    promptExcerpt: "Summarize this paper...",
    completedAt: 1780761600000,
  });

  assert.deepEqual(message, {
    type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
    payload: {
      siteId: "chatgpt",
      displayName: "ChatGPT",
      sessionKey: "conversation:abc",
      sourceTabId: 12,
      promptExcerpt: "Summarize this paper...",
      completedAt: 1780761600000,
    },
  });
});

test("createResponseCompletedMessage trims prompt excerpts and does not add chat content fields", () => {
  const message = createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:abc",
    sourceTabId: 12,
    promptExcerpt: "  hello  ",
    completedAt: 1780761600000,
    assistantText: "must not be forwarded",
  });

  assert.equal(message.payload.promptExcerpt, "hello");
  assert.equal(Object.hasOwn(message.payload, "assistantText"), false);
});

test("createTestNotificationMessage uses the expected type", () => {
  assert.deepEqual(createTestNotificationMessage(), {
    type: MESSAGE_TYPES.TEST_NOTIFICATION,
    payload: {},
  });
});
```

- [ ] **Step 2: Run the failing message tests**

Run:

```bash
npm test -- tests/messages.test.js
```

Expected: command fails because `package.json` and `src/shared/messages.js` do not exist.

- [ ] **Step 3: Add project harness and shared modules**

Create `package.json`:

```json
{
  "name": "chat-notify",
  "version": "0.1.0",
  "private": true,
  "description": "A privacy-conscious browser extension that notifies when AI chat responses complete.",
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test tests/*.test.js"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

Create `.gitignore`:

```gitignore
node_modules/
npm-debug.log*
.DS_Store
dist/
coverage/
*.log
```

Create `src/shared/constants.js`:

```js
(function attachConstants(root, factory) {
  const exports = factory();
  root.ChatNotify = Object.assign({}, root.ChatNotify, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildConstants() {
  const SITE_IDS = Object.freeze({
    CHATGPT: "chatgpt",
  });

  const RESPONSE_STATES = Object.freeze({
    IDLE: "idle",
    PENDING_USER_MESSAGE: "pending_user_message",
    RESPONDING: "responding",
    SETTLING: "settling",
    COMPLETED: "completed",
    CANCELED: "canceled",
    ERROR_OR_UNKNOWN: "error_or_unknown",
  });

  const DEFAULTS = Object.freeze({
    PROMPT_EXCERPT_LIMIT: 40,
    RESPONSE_START_TIMEOUT_MS: 30000,
    RESPONSE_SETTLE_MS: 1800,
    RESPONSE_TOTAL_TIMEOUT_MS: 20 * 60 * 1000,
  });

  const STORAGE_KEYS = Object.freeze({
    ENABLED: "enabled",
  });

  return {
    SITE_IDS,
    RESPONSE_STATES,
    DEFAULTS,
    STORAGE_KEYS,
  };
});
```

Create `src/shared/messages.js`:

```js
(function attachMessages(root, factory) {
  const exports = factory();
  root.ChatNotify = Object.assign({}, root.ChatNotify, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildMessages() {
  const MESSAGE_TYPES = Object.freeze({
    AI_RESPONSE_COMPLETED: "AI_RESPONSE_COMPLETED",
    TEST_NOTIFICATION: "TEST_NOTIFICATION",
    GET_POPUP_STATUS: "GET_POPUP_STATUS",
    SET_ENABLED: "SET_ENABLED",
    LIFECYCLE_EVENT: "CHAT_NOTIFY_LIFECYCLE_EVENT",
  });

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createResponseCompletedMessage(input) {
    return {
      type: MESSAGE_TYPES.AI_RESPONSE_COMPLETED,
      payload: {
        siteId: cleanString(input.siteId),
        displayName: cleanString(input.displayName),
        sessionKey: cleanString(input.sessionKey),
        sourceTabId: Number.isFinite(input.sourceTabId) ? input.sourceTabId : null,
        promptExcerpt: cleanString(input.promptExcerpt),
        completedAt: Number.isFinite(input.completedAt) ? input.completedAt : Date.now(),
      },
    };
  }

  function createTestNotificationMessage() {
    return {
      type: MESSAGE_TYPES.TEST_NOTIFICATION,
      payload: {},
    };
  }

  return {
    MESSAGE_TYPES,
    createResponseCompletedMessage,
    createTestNotificationMessage,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/messages.test.js
```

Expected: all tests in `tests/messages.test.js` pass.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore src/shared/constants.js src/shared/messages.js tests/messages.test.js
git commit -m "chore: add project harness and shared messages"
```

---

### Task 2: Prompt Excerpt Utility

**Files:**
- Create: `src/core/prompt-excerpt.js`
- Create: `tests/prompt-excerpt.test.js`

- [ ] **Step 1: Write failing prompt excerpt tests**

Create `tests/prompt-excerpt.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPromptExcerpt } = require("../src/core/prompt-excerpt.js");

test("returns empty string for empty input", () => {
  assert.equal(createPromptExcerpt(""), "");
  assert.equal(createPromptExcerpt(" \n\t "), "");
  assert.equal(createPromptExcerpt(null), "");
});

test("collapses whitespace", () => {
  assert.equal(createPromptExcerpt("hello\n\nworld\tfrom   chatgpt"), "hello world from chatgpt");
});

test("keeps short Chinese text", () => {
  assert.equal(createPromptExcerpt("请帮我总结这篇论文"), "请帮我总结这篇论文");
});

test("truncates long mixed text to visible character limit", () => {
  assert.equal(
    createPromptExcerpt("请帮我总结这篇论文并提取关键观点，然后给出三个行动建议", 12),
    "请帮我总结这篇论文并提取..."
  );
});

test("does not append ellipsis when text exactly matches the limit", () => {
  assert.equal(createPromptExcerpt("abcdef", 6), "abcdef");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/prompt-excerpt.test.js
```

Expected: fail with `Cannot find module '../src/core/prompt-excerpt.js'`.

- [ ] **Step 3: Implement prompt excerpt utility**

Create `src/core/prompt-excerpt.js`:

```js
(function attachPromptExcerpt(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory(existing);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildPromptExcerpt(existing) {
  const defaultLimit =
    existing.DEFAULTS && Number.isFinite(existing.DEFAULTS.PROMPT_EXCERPT_LIMIT)
      ? existing.DEFAULTS.PROMPT_EXCERPT_LIMIT
      : 40;

  function normalizePromptText(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function createPromptExcerpt(value, limit = defaultLimit) {
    const normalized = normalizePromptText(value);
    const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : defaultLimit;
    const characters = Array.from(normalized);

    if (characters.length === 0) {
      return "";
    }

    if (characters.length <= safeLimit) {
      return normalized;
    }

    return `${characters.slice(0, safeLimit).join("")}...`;
  }

  return {
    normalizePromptText,
    createPromptExcerpt,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/prompt-excerpt.test.js
```

Expected: all prompt excerpt tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt-excerpt.js tests/prompt-excerpt.test.js
git commit -m "feat: add prompt excerpt utility"
```

---

### Task 3: Response State Machine

**Files:**
- Create: `src/core/state-machine.js`
- Create: `tests/state-machine.test.js`

- [ ] **Step 1: Write failing state machine tests**

Create `tests/state-machine.test.js`:

```js
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

test("explicit zero settle completes on immediate tick after generation complete", () => {
  const machine = createResponseStateMachine({ now: () => 1000, settleMs: 0 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  machine.transition({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });
  const result = machine.transition({ type: "TICK" });

  assert.equal(result.state, RESPONSE_STATES.COMPLETED);
  assert.equal(result.shouldNotify, true);
});

test("explicit zero response start timeout abandons on tick after send", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({
    now: () => currentTime,
    responseStartTimeoutMs: 0,
  });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  currentTime = 1001;
  const result = machine.transition({ type: "TICK" });

  assert.equal(result.state, RESPONSE_STATES.ERROR_OR_UNKNOWN);
  assert.equal(result.shouldNotify, false);
});

test("total timeout from responding abandons without notification", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({
    now: () => currentTime,
    totalTimeoutMs: 5,
  });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  currentTime = 1006;
  const result = machine.transition({ type: "TICK" });

  assert.equal(result.state, RESPONSE_STATES.ERROR_OR_UNKNOWN);
  assert.equal(result.shouldNotify, false);
});

test("explicit zero total timeout is honored", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({ now: () => currentTime, totalTimeoutMs: 0 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  currentTime = 1001;
  const result = machine.transition({ type: "TICK" });

  assert.equal(result.state, RESPONSE_STATES.ERROR_OR_UNKNOWN);
  assert.equal(result.shouldNotify, false);
});

test("generation failure from responding cancels without notification", () => {
  const machine = createResponseStateMachine({ now: () => 1000 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  const result = machine.transition({ type: "GENERATION_FAILED", lifecycleId: "life-1" });

  assert.equal(result.state, RESPONSE_STATES.CANCELED);
  assert.equal(result.shouldNotify, false);
});

test("cancellation from settling does not notify", () => {
  const machine = createResponseStateMachine({ now: () => 1000 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  machine.transition({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });
  const result = machine.transition({ type: "GENERATION_CANCELED", lifecycleId: "life-1" });

  assert.equal(result.state, RESPONSE_STATES.CANCELED);
  assert.equal(result.shouldNotify, false);
});

test("new user send after completion resets machine for the new session", () => {
  let currentTime = 1000;
  const machine = createResponseStateMachine({ now: () => currentTime, settleMs: 10 });

  machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:a" });
  machine.transition({ type: "GENERATION_STARTED", lifecycleId: "life-1" });
  machine.transition({ type: "GENERATION_COMPLETED", lifecycleId: "life-1" });
  currentTime = 1011;
  assert.equal(machine.transition({ type: "TICK" }).shouldNotify, true);

  currentTime = 2000;
  const result = machine.transition({ type: "USER_MESSAGE_SENT", sessionKey: "conversation:b" });

  assert.equal(result.state, RESPONSE_STATES.PENDING_USER_MESSAGE);
  assert.equal(result.sessionKey, "conversation:b");
  assert.equal(result.shouldNotify, false);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/state-machine.test.js
```

Expected: fail with `Cannot find module '../src/core/state-machine.js'`.

- [ ] **Step 3: Implement state machine**

Create `src/core/state-machine.js`:

```js
(function attachStateMachine(root, factory) {
  const existing = root.ChatNotify || {};
  const constants =
    existing.RESPONSE_STATES && existing.DEFAULTS
      ? existing
      : typeof require === "function"
        ? require("../shared/constants.js")
        : existing;
  const exports = factory(constants);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildStateMachine(constants) {
  const { RESPONSE_STATES, DEFAULTS } = constants;

  function nonNegativeNumberOrDefault(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function createResponseStateMachine(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const responseStartTimeoutMs = nonNegativeNumberOrDefault(
      options.responseStartTimeoutMs,
      DEFAULTS.RESPONSE_START_TIMEOUT_MS
    );
    const settleMs = nonNegativeNumberOrDefault(options.settleMs, DEFAULTS.RESPONSE_SETTLE_MS);
    const totalTimeoutMs = nonNegativeNumberOrDefault(
      options.totalTimeoutMs,
      DEFAULTS.RESPONSE_TOTAL_TIMEOUT_MS
    );

    const context = {
      state: RESPONSE_STATES.IDLE,
      sessionKey: "",
      lifecycleId: "",
      startedAt: 0,
      lastChangedAt: 0,
      settleStartedAt: 0,
      latestSnapshot: "",
      notified: false,
    };

    function snapshot(extra = {}) {
      return Object.assign(
        {
          state: context.state,
          sessionKey: context.sessionKey,
          lifecycleId: context.lifecycleId,
          latestSnapshot: context.latestSnapshot,
          shouldNotify: false,
        },
        extra
      );
    }

    function abandon() {
      context.state = RESPONSE_STATES.ERROR_OR_UNKNOWN;
      return snapshot();
    }

    function transition(event) {
      const timestamp = now();

      if (event.type === "USER_MESSAGE_SENT") {
        context.state = RESPONSE_STATES.PENDING_USER_MESSAGE;
        context.sessionKey = event.sessionKey;
        context.lifecycleId = "";
        context.startedAt = timestamp;
        context.lastChangedAt = timestamp;
        context.settleStartedAt = 0;
        context.latestSnapshot = "";
        context.notified = false;
        return snapshot();
      }

      if (context.notified) {
        return snapshot();
      }

      if (context.state === RESPONSE_STATES.IDLE) {
        return snapshot();
      }

      if (event.type === "GENERATION_CANCELED" || event.type === "GENERATION_FAILED") {
        context.state = RESPONSE_STATES.CANCELED;
        return snapshot();
      }

      if (
        event.type === "TICK" &&
        context.startedAt > 0 &&
        timestamp - context.startedAt > totalTimeoutMs
      ) {
        return abandon();
      }

      if (context.state === RESPONSE_STATES.PENDING_USER_MESSAGE) {
        if (event.type === "GENERATION_STARTED") {
          context.state = RESPONSE_STATES.RESPONDING;
          context.lifecycleId = event.lifecycleId || context.lifecycleId;
          context.lastChangedAt = timestamp;
          return snapshot();
        }

        if (event.type === "TICK" && timestamp - context.startedAt > responseStartTimeoutMs) {
          return abandon();
        }
      }

      if (context.state === RESPONSE_STATES.RESPONDING) {
        if (event.type === "ASSISTANT_SNAPSHOT_CHANGED") {
          context.latestSnapshot = event.snapshot || "";
          context.lastChangedAt = timestamp;
          return snapshot();
        }

        if (event.type === "GENERATION_COMPLETED") {
          context.state = RESPONSE_STATES.SETTLING;
          context.settleStartedAt = timestamp;
          return snapshot();
        }
      }

      if (context.state === RESPONSE_STATES.SETTLING) {
        if (event.type === "ASSISTANT_SNAPSHOT_CHANGED") {
          context.latestSnapshot = event.snapshot || "";
          context.settleStartedAt = timestamp;
          return snapshot();
        }

        if (event.type === "TICK" && timestamp - context.settleStartedAt >= settleMs) {
          context.state = RESPONSE_STATES.COMPLETED;
          context.notified = true;
          return snapshot({ shouldNotify: true });
        }
      }

      return snapshot();
    }

    return {
      transition,
      getSnapshot: () => snapshot(),
    };
  }

  return {
    createResponseStateMachine,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/state-machine.test.js
```

Expected: all state machine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/state-machine.js tests/state-machine.test.js
git commit -m "feat: add response state machine"
```

---

### Task 4: Session Tracker

**Files:**
- Create: `src/core/session-tracker.js`
- Create: `tests/session-tracker.test.js`

- [ ] **Step 1: Write failing session tracker tests**

Create `tests/session-tracker.test.js`:

```js
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

test("does not migrate over an existing stable conversation key", () => {
  const tracker = createSessionTracker({ now: () => 1000 });
  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "conversation:stable",
    sourceTabId: 9,
    promptExcerpt: "existing question",
  });
  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "temp:1",
    sourceTabId: 4,
    promptExcerpt: "new chat",
  });

  const migrated = tracker.migrateSessionKey("temp:1", "conversation:stable");

  assert.equal(migrated, false);
  assert.equal(tracker.get("conversation:stable").promptExcerpt, "existing question");
  assert.equal(tracker.get("conversation:stable").sourceTabId, 9);
  assert.equal(tracker.get("temp:1").promptExcerpt, "new chat");
});

test("clear removes prompt excerpt from memory", () => {
  const tracker = createSessionTracker({ now: () => 1000 });
  tracker.upsertPending({
    siteId: "chatgpt",
    sessionKey: "conversation:a",
    sourceTabId: 1,
    promptExcerpt: "sensitive",
    latestAssistantSnapshot: "also sensitive",
  });

  const removed = tracker.remove("conversation:a");

  assert.equal(removed.promptExcerpt, "");
  assert.equal(removed.latestAssistantSnapshot, "");
  assert.equal(tracker.get("conversation:a"), null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/session-tracker.test.js
```

Expected: fail with `Cannot find module '../src/core/session-tracker.js'`.

- [ ] **Step 3: Implement session tracker**

Create `src/core/session-tracker.js`:

```js
(function attachSessionTracker(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildSessionTracker() {
  function createTempSessionKey(seed) {
    return `temp:${seed || Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  function createSessionTracker(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const sessions = new Map();

    function clone(record) {
      return record ? Object.assign({}, record) : null;
    }

    function upsertPending(input) {
      const existing = sessions.get(input.sessionKey);
      const record = Object.assign({}, existing, {
        siteId: input.siteId,
        sessionKey: input.sessionKey,
        sourceTabId: Number.isFinite(input.sourceTabId) ? input.sourceTabId : null,
        promptExcerpt: input.promptExcerpt || "",
        status: input.status || (existing && existing.status) || "pending_user_message",
        startedAt: existing ? existing.startedAt : now(),
        lastSeenAt: now(),
        latestAssistantSnapshot:
          input.latestAssistantSnapshot ||
          (existing && existing.latestAssistantSnapshot) ||
          "",
        lifecycleId: input.lifecycleId || (existing && existing.lifecycleId) || "",
      });

      sessions.set(record.sessionKey, record);
      return clone(record);
    }

    function get(sessionKey) {
      return clone(sessions.get(sessionKey));
    }

    function list() {
      return Array.from(sessions.values()).map(clone);
    }

    function update(sessionKey, patch) {
      const existing = sessions.get(sessionKey);
      if (!existing) {
        return null;
      }
      const record = Object.assign({}, existing, patch, { lastSeenAt: now() });
      sessions.set(sessionKey, record);
      return clone(record);
    }

    function migrateSessionKey(fromKey, toKey) {
      if (!fromKey || !toKey || fromKey === toKey || !sessions.has(fromKey) || sessions.has(toKey)) {
        return false;
      }
      const record = sessions.get(fromKey);
      sessions.delete(fromKey);
      sessions.set(toKey, Object.assign({}, record, { sessionKey: toKey, lastSeenAt: now() }));
      return true;
    }

    function remove(sessionKey) {
      const existing = sessions.get(sessionKey);
      if (!existing) {
        return null;
      }
      sessions.delete(sessionKey);
      return Object.assign({}, existing, {
        promptExcerpt: "",
        latestAssistantSnapshot: "",
      });
    }

    return {
      upsertPending,
      get,
      list,
      update,
      migrateSessionKey,
      remove,
      createTempSessionKey,
    };
  }

  return {
    createSessionTracker,
    createTempSessionKey,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/session-tracker.test.js
```

Expected: all session tracker tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/session-tracker.js tests/session-tracker.test.js
git commit -m "feat: add session tracker"
```

---

### Task 5: Background Notification Service

**Files:**
- Create: `src/background/service-worker.js`
- Create: `tests/background.test.js`

- [ ] **Step 1: Write failing background tests**

Create `tests/background.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/background.test.js
```

Expected: fail with `Cannot find module '../src/background/service-worker.js'`.

- [ ] **Step 3: Implement notification service**

Create `src/background/service-worker.js`:

```js
(function attachBackground(root, factory) {
  if (
    typeof importScripts === "function" &&
    !(root.ChatNotify && root.ChatNotify.MESSAGE_TYPES)
  ) {
    importScripts("../shared/messages.js");
  }
  const existing = root.ChatNotify || {};
  const messages =
    existing.MESSAGE_TYPES
      ? existing
      : typeof require === "function"
        ? require("../shared/messages.js")
        : existing;
  const exports = factory(messages);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildBackground(messages) {
  const { MESSAGE_TYPES } = messages;

  function sanitizeNotificationIdPart(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
  }

  function buildCompletionNotification(payload) {
    const displayName = payload.displayName || "AI";
    const promptExcerpt = payload.promptExcerpt || "";
    return {
      type: "basic",
      iconUrl: "assets/icon.svg",
      title: `${displayName} response complete`,
      message: promptExcerpt ? `"${promptExcerpt}" is ready` : "Your response is ready",
      priority: 1,
    };
  }

  function createNotificationService(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    function notify(id, optionsForNotification) {
      return new Promise((resolve) => {
        chromeApi.notifications.create(id, optionsForNotification, (createdId) => {
          resolve(createdId);
        });
      });
    }

    async function handleMessage(message, sender = {}) {
      if (!message || message.type !== MESSAGE_TYPES.AI_RESPONSE_COMPLETED) {
        return { ok: false, ignored: true };
      }

      const payload = message.payload || {};
      const sourceTabId =
        Number.isFinite(payload.sourceTabId) ? payload.sourceTabId : sender.tab && sender.tab.id;
      const id = [
        "chat-notify",
        sanitizeNotificationIdPart(payload.siteId),
        sanitizeNotificationIdPart(payload.sessionKey),
        sanitizeNotificationIdPart(sourceTabId),
        now(),
      ].join(":");

      await notify(id, buildCompletionNotification(payload));
      return { ok: true, notificationId: id };
    }

    return {
      handleMessage,
      buildCompletionNotification,
    };
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    const service = createNotificationService({ chromeApi: chrome });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      service.handleMessage(message, sender).then(sendResponse);
      return true;
    });
  }

  return {
    createNotificationService,
    buildCompletionNotification,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/background.test.js
```

Expected: all background tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.js tests/background.test.js
git commit -m "feat: add notification background service"
```

---

### Task 6: Manifest And Extension Shell

**Files:**
- Create: `manifest.json`
- Create: `assets/icon.svg`
- Create: `tests/manifest.test.js`

- [ ] **Step 1: Write failing manifest tests**

Create `tests/manifest.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("manifest uses MV3 and minimal permissions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["notifications", "storage"].sort());
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
  ]);
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
});

test("manifest declares content scripts in dependency order", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );
  const scripts = manifest.content_scripts[0].js;

  assert.deepEqual(scripts, [
    "src/shared/constants.js",
    "src/shared/messages.js",
    "src/core/prompt-excerpt.js",
    "src/core/state-machine.js",
    "src/core/session-tracker.js",
    "src/core/dom-watch.js",
    "src/adapters/adapter-contract.js",
    "src/adapters/chatgpt-adapter.js",
    "src/core/monitor-controller.js",
    "src/content/content-script.js",
  ]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/manifest.test.js
```

Expected: fail because `manifest.json` does not exist.

- [ ] **Step 3: Add manifest and icon**

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Chat Notify",
  "version": "0.1.0",
  "description": "Notify when ChatGPT finishes responding.",
  "permissions": ["notifications", "storage"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js"
  },
  "action": {
    "default_title": "Chat Notify",
    "default_popup": "src/popup/popup.html"
  },
  "icons": {
    "128": "assets/icon.svg"
  },
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*"
      ],
      "js": [
        "src/shared/constants.js",
        "src/shared/messages.js",
        "src/core/prompt-excerpt.js",
        "src/core/state-machine.js",
        "src/core/session-tracker.js",
        "src/core/dom-watch.js",
        "src/adapters/adapter-contract.js",
        "src/adapters/chatgpt-adapter.js",
        "src/core/monitor-controller.js",
        "src/content/content-script.js"
      ],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/content/page-lifecycle-bridge.js", "assets/icon.svg"],
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*"
      ]
    }
  ]
}
```

Create `assets/icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Chat Notify icon">
  <rect width="128" height="128" rx="24" fill="#111827"/>
  <path d="M30 35h68a12 12 0 0 1 12 12v34a12 12 0 0 1-12 12H58L36 109V93h-6a12 12 0 0 1-12-12V47a12 12 0 0 1 12-12Z" fill="#f9fafb"/>
  <circle cx="46" cy="64" r="6" fill="#2563eb"/>
  <circle cx="64" cy="64" r="6" fill="#16a34a"/>
  <circle cx="82" cy="64" r="6" fill="#f59e0b"/>
</svg>
```

- [ ] **Step 4: Run manifest tests**

Run:

```bash
npm test -- tests/manifest.test.js
```

Expected: all manifest tests pass.

- [ ] **Step 5: Commit**

```bash
git add manifest.json assets/icon.svg tests/manifest.test.js
git commit -m "chore: add extension manifest"
```

---

### Task 7: ChatGPT Adapter And DOM Watch Helpers

**Files:**
- Create: `src/core/dom-watch.js`
- Create: `src/adapters/adapter-contract.js`
- Create: `src/adapters/chatgpt-adapter.js`
- Create: `tests/chatgpt-adapter.test.js`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/chatgpt-adapter.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatGptAdapter } = require("../src/adapters/chatgpt-adapter.js");

test("matches ChatGPT hosts", () => {
  const adapter = createChatGptAdapter();

  assert.equal(adapter.matchesLocation(new URL("https://chatgpt.com/c/abc")), true);
  assert.equal(adapter.matchesLocation(new URL("https://chat.openai.com/c/abc")), true);
  assert.equal(adapter.matchesLocation(new URL("https://claude.ai/chat/abc")), false);
});

test("extracts stable session key from conversation URL", () => {
  const adapter = createChatGptAdapter();

  assert.equal(
    adapter.getSessionKey(new URL("https://chatgpt.com/c/12345"), null),
    "conversation:12345"
  );
});

test("uses temporary session key for new chat URL", () => {
  const adapter = createChatGptAdapter({ tempKeySeed: () => "seed-1" });

  assert.equal(adapter.getSessionKey(new URL("https://chatgpt.com/"), null), "temp:chatgpt:seed-1");
});

test("normalizes lifecycle events without forwarding body data", () => {
  const adapter = createChatGptAdapter();
  const event = adapter.normalizeLifecycleEvent({
    lifecycleId: "life-1",
    phase: "completed",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
    body: "sensitive",
    responseText: "sensitive",
  });

  assert.deepEqual(event, {
    type: "GENERATION_COMPLETED",
    lifecycleId: "life-1",
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/chatgpt-adapter.test.js
```

Expected: fail with `Cannot find module '../src/adapters/chatgpt-adapter.js'`.

- [ ] **Step 3: Implement DOM watch, adapter contract, and ChatGPT adapter**

Create `src/core/dom-watch.js`:

```js
(function attachDomWatch(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildDomWatch() {
  function observeDom(root, callback) {
    if (!root || typeof MutationObserver === "undefined") {
      return () => {};
    }
    const observer = new MutationObserver(() => callback());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }

  return {
    observeDom,
  };
});
```

Create `src/adapters/adapter-contract.js`:

```js
(function attachAdapterContract(root, factory) {
  const existing = root.ChatNotify || {};
  const exports = factory();
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildAdapterContract() {
  const REQUIRED_ADAPTER_METHODS = Object.freeze([
    "matchesLocation",
    "getSessionKey",
    "isSendEvent",
    "getPromptDraft",
    "getLatestUserMessage",
    "isResponding",
    "getLatestAssistantSnapshot",
    "observePage",
    "normalizeLifecycleEvent",
  ]);

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      return false;
    }
    return REQUIRED_ADAPTER_METHODS.every((method) => typeof adapter[method] === "function");
  }

  return {
    REQUIRED_ADAPTER_METHODS,
    validateAdapter,
  };
});
```

Create `src/adapters/chatgpt-adapter.js`:

```js
(function attachChatGptAdapter(root, factory) {
  const existing = root.ChatNotify || {};
  const domWatch =
    existing.observeDom
      ? existing
      : typeof require === "function"
        ? require("../core/dom-watch.js")
        : existing;
  const exports = factory(domWatch);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildChatGptAdapter(domWatch) {
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const GENERATION_URL_HINTS = [
    "/backend-api/conversation",
    "/backend-api/f/conversation",
    "/conversation",
  ];

  function createChatGptAdapter(options = {}) {
    const tempKeySeed =
      typeof options.tempKeySeed === "function"
        ? options.tempKeySeed
        : () => `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    function matchesLocation(location) {
      return CHATGPT_HOSTS.has(location.hostname);
    }

    function getSessionKey(location) {
      const match = location.pathname.match(/\/c\/([^/?#]+)/);
      if (match && match[1]) {
        return `conversation:${decodeURIComponent(match[1])}`;
      }
      return `temp:chatgpt:${tempKeySeed()}`;
    }

    function isSendEvent(event) {
      const target = event && event.target;
      if (!target) {
        return false;
      }

      if (event.type === "click") {
        const button = target.closest && target.closest("button");
        const label = button && `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`;
        return Boolean(button && /send|发送/i.test(label));
      }

      if (event.type === "keydown") {
        return event.key === "Enter" && !event.shiftKey && !event.isComposing;
      }

      return false;
    }

    function getPromptDraft(root) {
      const input =
        root.querySelector("#prompt-textarea") ||
        root.querySelector('[contenteditable="true"]') ||
        root.querySelector("textarea");
      return input ? input.innerText || input.value || input.textContent || "" : "";
    }

    function getLatestUserMessage(root) {
      const candidates = Array.from(
        root.querySelectorAll('[data-message-author-role="user"], [data-testid*="user"]')
      );
      const latest = candidates.at(-1);
      return latest ? latest.textContent || "" : "";
    }

    function isResponding(root) {
      const buttons = Array.from(root.querySelectorAll("button"));
      return buttons.some((button) =>
        /stop|停止|cancel|取消/i.test(`${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`)
      );
    }

    function getLatestAssistantSnapshot(root) {
      const candidates = Array.from(
        root.querySelectorAll('[data-message-author-role="assistant"], [data-testid*="assistant"]')
      );
      const latest = candidates.at(-1);
      return latest ? (latest.textContent || "").trim() : "";
    }

    function observePage(root, callback) {
      return domWatch.observeDom(root, callback);
    }

    function looksLikeGenerationUrl(url) {
      return GENERATION_URL_HINTS.some((hint) => String(url || "").includes(hint));
    }

    function normalizeLifecycleEvent(event) {
      if (!event || !looksLikeGenerationUrl(event.url)) {
        return null;
      }

      const base = {
        lifecycleId: event.lifecycleId,
        url: event.url,
        method: event.method || "GET",
      };

      if (event.phase === "started") {
        return Object.assign({ type: "GENERATION_STARTED" }, base);
      }
      if (event.phase === "completed") {
        return Object.assign({ type: "GENERATION_COMPLETED" }, base);
      }
      if (event.phase === "canceled") {
        return Object.assign({ type: "GENERATION_CANCELED" }, base);
      }
      if (event.phase === "failed") {
        return Object.assign({ type: "GENERATION_FAILED" }, base);
      }
      return null;
    }

    return {
      siteId: "chatgpt",
      displayName: "ChatGPT",
      canObserveLifecycle: true,
      matchesLocation,
      getSessionKey,
      isSendEvent,
      getPromptDraft,
      getLatestUserMessage,
      isResponding,
      getLatestAssistantSnapshot,
      observePage,
      normalizeLifecycleEvent,
    };
  }

  return {
    createChatGptAdapter,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/chatgpt-adapter.test.js
```

Expected: all adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/dom-watch.js src/adapters/adapter-contract.js src/adapters/chatgpt-adapter.js tests/chatgpt-adapter.test.js
git commit -m "feat: add ChatGPT adapter"
```

---

### Task 8: Page Lifecycle Bridge

**Files:**
- Create: `src/content/page-lifecycle-bridge.js`

- [ ] **Step 1: Create the bridge script**

Create `src/content/page-lifecycle-bridge.js`:

```js
(function installChatNotifyLifecycleBridge() {
  if (window.__chatNotifyLifecycleBridgeInstalled) {
    return;
  }
  window.__chatNotifyLifecycleBridgeInstalled = true;

  const originalFetch = window.fetch;
  let sequence = 0;

  function isObservableRequest(input) {
    const url = typeof input === "string" ? input : input && input.url;
    return typeof url === "string" && url.includes("/backend-api/") && url.includes("conversation");
  }

  function getRequestMeta(input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method =
      (init && init.method) ||
      (input && input.method) ||
      "GET";
    return {
      url: String(url || ""),
      method: String(method || "GET").toUpperCase(),
    };
  }

  function postLifecycleEvent(detail) {
    window.postMessage(
      {
        source: "chat-notify-page-lifecycle-bridge",
        detail,
      },
      window.location.origin
    );
  }

  window.fetch = async function chatNotifyFetch(input, init) {
    if (!isObservableRequest(input)) {
      return originalFetch.apply(this, arguments);
    }

    const lifecycleId = `fetch:${Date.now()}:${++sequence}`;
    const meta = getRequestMeta(input, init);

    postLifecycleEvent(Object.assign({ lifecycleId, phase: "started" }, meta));

    try {
      const response = await originalFetch.apply(this, arguments);

      if (!response.body || typeof ReadableStream === "undefined") {
        postLifecycleEvent(Object.assign({ lifecycleId, phase: "completed" }, meta));
        return response;
      }

      const reader = response.body.getReader();
      const monitoredBody = new ReadableStream({
        start(controller) {
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) {
                postLifecycleEvent(Object.assign({ lifecycleId, phase: "completed" }, meta));
                controller.close();
                return;
              }

              controller.enqueue(value);
              pump();
            }).catch((error) => {
              const phase = error && error.name === "AbortError" ? "canceled" : "failed";
              postLifecycleEvent(Object.assign({ lifecycleId, phase }, meta));
              controller.error(error);
            });
          }

          pump();
        },
        cancel(reason) {
          postLifecycleEvent(Object.assign({ lifecycleId, phase: "canceled" }, meta));
          return reader.cancel(reason);
        },
      });

      return new Response(monitoredBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const phase = error && error.name === "AbortError" ? "canceled" : "failed";
      postLifecycleEvent(Object.assign({ lifecycleId, phase }, meta));
      throw error;
    }
  };
})();
```

- [ ] **Step 2: Manually inspect bridge privacy**

Run:

```bash
rg -n "requestBody|responseText|assistantText|authorization|token|prompt" src/content/page-lifecycle-bridge.js
```

Expected: no matches. The bridge may reference `response.body` and `response.headers` only to preserve the original streaming response for ChatGPT; it must not post those values to the content script.

- [ ] **Step 3: Commit**

```bash
git add src/content/page-lifecycle-bridge.js
git commit -m "feat: add page lifecycle bridge"
```

---

### Task 9: Monitor Controller

**Files:**
- Create: `src/core/monitor-controller.js`
- Create: `tests/monitor-controller.test.js`

- [ ] **Step 1: Write failing monitor controller tests**

Create `tests/monitor-controller.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitorController } = require("../src/core/monitor-controller.js");

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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/monitor-controller.test.js
```

Expected: fail with `Cannot find module '../src/core/monitor-controller.js'`.

- [ ] **Step 3: Implement monitor controller**

Create `src/core/monitor-controller.js`:

```js
(function attachMonitorController(root, factory) {
  const existing = root.ChatNotify || {};
  const dependencies =
    existing.createPromptExcerpt && existing.createResponseStateMachine && existing.createSessionTracker
      ? existing
      : typeof require === "function"
        ? Object.assign(
            {},
            require("./prompt-excerpt.js"),
            require("./state-machine.js"),
            require("./session-tracker.js"),
            require("../shared/constants.js")
          )
        : existing;
  const exports = factory(dependencies);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildMonitorController(deps) {
  function createMonitorController(options) {
    const adapter = options.adapter;
    const root = options.root || document;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const tracker = deps.createSessionTracker({ now });
    const machines = new Map();
    const onCompleted = typeof options.onCompleted === "function" ? options.onCompleted : () => {};

    function getOrCreateMachine(sessionKey) {
      if (!machines.has(sessionKey)) {
        machines.set(
          sessionKey,
          deps.createResponseStateMachine({
            now,
            settleMs: options.settleMs,
            responseStartTimeoutMs: options.responseStartTimeoutMs,
          })
        );
      }
      return machines.get(sessionKey);
    }

    function currentSessionKey() {
      const location =
        typeof window !== "undefined" && window.location
          ? window.location
          : new URL("https://chatgpt.com/");
      return adapter.getSessionKey(location, root);
    }

    function capturePromptExcerpt() {
      return deps.createPromptExcerpt(adapter.getPromptDraft(root) || adapter.getLatestUserMessage(root));
    }

    function handleUserSend() {
      const sessionKey = currentSessionKey();
      const promptExcerpt = capturePromptExcerpt();
      tracker.upsertPending({
        siteId: adapter.siteId,
        sessionKey,
        sourceTabId: options.sourceTabId,
        promptExcerpt,
      });
      getOrCreateMachine(sessionKey).transition({ type: "USER_MESSAGE_SENT", sessionKey });
      return sessionKey;
    }

    function findSessionForLifecycle(lifecycleEvent) {
      const sessions = tracker.list();
      const matching = sessions.find((session) => session.lifecycleId === lifecycleEvent.lifecycleId);
      if (matching) {
        return matching.sessionKey;
      }
      const pending = sessions.find((session) => session.status === deps.RESPONSE_STATES.PENDING_USER_MESSAGE);
      return pending ? pending.sessionKey : "";
    }

    function completeIfNeeded(sessionKey, result) {
      const record = tracker.get(sessionKey);
      if (!record || !result.shouldNotify) {
        return;
      }
      onCompleted({
        siteId: record.siteId,
        displayName: adapter.displayName,
        sessionKey: record.sessionKey,
        sourceTabId: record.sourceTabId,
        promptExcerpt: record.promptExcerpt,
        completedAt: now(),
      });
      tracker.remove(sessionKey);
      machines.delete(sessionKey);
    }

    function handleLifecycleEvent(lifecycleEvent) {
      const sessionKey = findSessionForLifecycle(lifecycleEvent);
      if (!sessionKey) {
        return;
      }

      const machine = getOrCreateMachine(sessionKey);
      const result = machine.transition(lifecycleEvent);

      if (lifecycleEvent.lifecycleId) {
        tracker.update(sessionKey, {
          lifecycleId: lifecycleEvent.lifecycleId,
          status: result.state,
        });
      }

      if (
        result.state === deps.RESPONSE_STATES.CANCELED ||
        result.state === deps.RESPONSE_STATES.ERROR_OR_UNKNOWN
      ) {
        tracker.remove(sessionKey);
        machines.delete(sessionKey);
        return;
      }

      completeIfNeeded(sessionKey, result);
    }

    function tick() {
      for (const record of tracker.list()) {
        const machine = getOrCreateMachine(record.sessionKey);
        const result = machine.transition({ type: "TICK" });
        if (
          result.state === deps.RESPONSE_STATES.CANCELED ||
          result.state === deps.RESPONSE_STATES.ERROR_OR_UNKNOWN
        ) {
          tracker.remove(record.sessionKey);
          machines.delete(record.sessionKey);
        } else {
          tracker.update(record.sessionKey, { status: result.state });
          completeIfNeeded(record.sessionKey, result);
        }
      }
    }

    return {
      handleUserSend,
      handleLifecycleEvent,
      tick,
      getPendingSessions: tracker.list,
    };
  }

  return {
    createMonitorController,
  };
});
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- tests/monitor-controller.test.js
```

Expected: all monitor controller tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/monitor-controller.js tests/monitor-controller.test.js
git commit -m "feat: add session-scoped monitor controller"
```

---

### Task 10: Content Script Entry Point

**Files:**
- Create: `src/content/content-script.js`

- [ ] **Step 1: Implement content script**

Create `src/content/content-script.js`:

```js
(function installChatNotifyContentScript() {
  const api = globalThis.ChatNotify;
  if (!api || globalThis.__chatNotifyContentScriptInstalled) {
    return;
  }
  globalThis.__chatNotifyContentScriptInstalled = true;

  const adapters = [api.createChatGptAdapter()];
  const adapter = adapters.find((candidate) => candidate.matchesLocation(window.location));

  if (!adapter) {
    return;
  }

  function sendCompletion(event) {
    chrome.runtime.sendMessage(api.createResponseCompletedMessage(event));
  }

  function installLifecycleBridge() {
    if (!adapter.canObserveLifecycle) {
      return;
    }
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content/page-lifecycle-bridge.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  const controller = api.createMonitorController({
    adapter,
    root: document,
    sourceTabId: null,
    onCompleted: sendCompletion,
  });

  function handlePossibleSend(event) {
    if (!adapter.isSendEvent(event)) {
      return;
    }
    window.setTimeout(() => controller.handleUserSend(), 0);
  }

  function handleLifecycleMessage(event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data || {};
    if (data.source !== "chat-notify-page-lifecycle-bridge") {
      return;
    }
    const normalized = adapter.normalizeLifecycleEvent(data.detail);
    if (normalized) {
      controller.handleLifecycleEvent(normalized);
    }
  }

  chrome.storage.sync.get({ enabled: true }, (settings) => {
    if (!settings.enabled) {
      return;
    }
    installLifecycleBridge();
    document.addEventListener("click", handlePossibleSend, true);
    document.addEventListener("keydown", handlePossibleSend, true);
    window.addEventListener("message", handleLifecycleMessage);
    window.setInterval(() => controller.tick(), 500);
  });
})();
```

- [ ] **Step 2: Run full unit tests**

Run:

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/content/content-script.js
git commit -m "feat: add content script entry point"
```

---

### Task 11: Popup UI

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.js`

- [ ] **Step 1: Create popup HTML**

Create `src/popup/popup.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Chat Notify</title>
    <link rel="stylesheet" href="./popup.css">
  </head>
  <body>
    <main class="popup">
      <header class="header">
        <img src="../../assets/icon.svg" alt="" class="icon">
        <div>
          <h1>Chat Notify</h1>
          <p id="site-status">Checking page...</p>
        </div>
      </header>

      <label class="toggle-row">
        <span>Enabled</span>
        <input id="enabled-toggle" type="checkbox">
      </label>

      <button id="test-notification" type="button">Test notification</button>

      <p class="privacy">
        Prompt excerpts stay in local memory for the active response and are cleared after notification.
      </p>
    </main>
    <script src="../shared/messages.js"></script>
    <script src="./popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create popup CSS**

Create `src/popup/popup.css`:

```css
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  width: 320px;
  background: #f8fafc;
  color: #111827;
}

.popup {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon {
  width: 36px;
  height: 36px;
}

h1 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
}

p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #4b5563;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  font-size: 14px;
}

button {
  min-height: 34px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: #f3f4f6;
}

.privacy {
  padding-top: 2px;
}
```

- [ ] **Step 3: Create popup JavaScript**

Create `src/popup/popup.js`:

```js
(function installPopup() {
  const enabledToggle = document.getElementById("enabled-toggle");
  const testButton = document.getElementById("test-notification");
  const siteStatus = document.getElementById("site-status");

  chrome.storage.sync.get({ enabled: true }, (settings) => {
    enabledToggle.checked = Boolean(settings.enabled);
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0] && tabs[0].url ? new URL(tabs[0].url) : null;
    const supported = url && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com");
    siteStatus.textContent = supported ? "Current page is supported" : "Current page is not supported";
  });

  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  testButton.addEventListener("click", () => {
    chrome.runtime.sendMessage(ChatNotify.createTestNotificationMessage());
  });
})();
```

- [ ] **Step 4: Update background service to handle test notifications**

Modify `src/background/service-worker.js` so `handleMessage` includes this branch before the completion branch:

```js
if (message && message.type === MESSAGE_TYPES.TEST_NOTIFICATION) {
  const id = `chat-notify:test:${now()}`;
  await notify(id, {
    type: "basic",
    iconUrl: "assets/icon.svg",
    title: "Chat Notify test",
    message: "Notifications are working",
    priority: 1,
  });
  return { ok: true, notificationId: id };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/popup/popup.html src/popup/popup.css src/popup/popup.js src/background/service-worker.js
git commit -m "feat: add popup controls"
```

---

### Task 12: README And Manual Validation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:

```md
# Chat Notify

Chat Notify is a privacy-conscious browser extension that notifies you when ChatGPT finishes responding.

The MVP supports ChatGPT on:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## What It Does

- Starts monitoring only after you send a ChatGPT message.
- Supports multiple active ChatGPT sessions.
- Supports multiple tabs and same-tab conversation switching when the response lifecycle remains observable.
- Sends a browser/system notification when an observable response completes.
- Shows a short excerpt of your prompt in the notification.

## Privacy

Chat Notify does not upload, sync, or persist chat content.

Prompt excerpts are kept only in local extension memory for the pending response. They are cleared after completion, cancellation, timeout, or abandonment. The extension does not make network requests to project-owned or third-party servers.

## Install For Local Development

1. Open Chrome or Edge Chromium.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this repository directory.
6. Open ChatGPT and send a message.

## Test

```bash
npm test
```

## Manual Validation

- Load the unpacked extension in Chrome.
- Send a short ChatGPT prompt and confirm one notification after completion.
- Open two ChatGPT tabs, send prompts in both, and confirm two independent notifications.
- In one ChatGPT tab, send a prompt in Conversation A, switch to Conversation B, send another prompt, and confirm both observable completions notify independently.
- In one ChatGPT tab, send a prompt in Conversation A, switch to Conversation B, and confirm no completion notification appears for A if ChatGPT canceled A's generation.
- Open an existing historical conversation and confirm no notification appears.
- Refresh a ChatGPT page and confirm no notification appears.
- Switch away from the ChatGPT tab during generation and confirm notification still appears.
- Disable the extension in the popup and confirm no notification appears.
- Use the popup test notification button and confirm it works.

## Current Limits

- ChatGPT only.
- Chrome and Edge Chromium only.
- No sound notifications.
- No webhook integrations.
- No cloud sync.
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 13: Final Verification

**Files:**
- Modify only files required by failures discovered during verification.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Verify manifest JSON parses**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"
```

Expected output:

```text
manifest ok
```

- [ ] **Step 3: Search for privacy violations in bridge and messages**

Run:

```bash
rg -n "assistantText|responseText|authorization|auth token|requestBody|responseBody" src tests README.md
```

Expected: either no matches or matches only in tests/documentation that assert those fields are not forwarded.

- [ ] **Step 4: Review git diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: `git status --short` shows no uncommitted changes after any required fixes are committed.

---

## Plan Self-Review

Spec coverage:

- ChatGPT-only host scope is covered by Task 6 manifest and Task 7 adapter tests.
- User-initiated monitoring is covered by Task 9 monitor controller and Task 10 content script send-event wiring.
- Multi-session and multi-tab requirements are covered by Task 4 session tracker, Task 9 monitor controller, and Task 12 manual validation.
- Same-tab conversation switching is covered by Task 8 page lifecycle bridge, Task 9 lifecycle handling, and Task 12 manual validation.
- Prompt excerpt behavior is covered by Task 2 tests and implementation.
- Local browser notifications are covered by Task 5 background service and Task 11 popup test notification.
- Privacy constraints are covered by Task 5 sanitized notification payloads, Task 8 bridge privacy scan, and Task 12 README.
- Popup requirements are covered by Task 11.
- Testing requirements are covered by Tasks 1-13.

Placeholder scan:

- The plan contains no forbidden markers or unspecified implementation steps.
- Each file creation task includes concrete content or a concrete verification command.

Type consistency:

- State names use `RESPONSE_STATES` from `src/shared/constants.js`.
- Message names use `MESSAGE_TYPES` from `src/shared/messages.js`.
- Pending session records consistently use `siteId`, `sessionKey`, `sourceTabId`, `promptExcerpt`, `status`, `startedAt`, `lastSeenAt`, `latestAssistantSnapshot`, and `lifecycleId`.
- Completion events consistently use `siteId`, `displayName`, `sessionKey`, `sourceTabId`, `promptExcerpt`, and `completedAt`.
