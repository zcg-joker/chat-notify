# Reliability Diagnostics And Gemini Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact reliability diagnostics timeline and MVP support for the regular Gemini web app at `gemini.google.com` without publishing a new release yet.

**Architecture:** Keep adapters responsible for site-specific behavior, extend the lifecycle bridge to accept serializable site configs, and route metadata-only diagnostic events through the existing runtime message/background storage path. Preserve ChatGPT behavior while adding Gemini as the second adapter.

**Tech Stack:** Chrome MV3 extension, plain JavaScript UMD modules, Node `node --test`, jsdom-based unit tests, existing package script.

---

## File Structure

- Modify `manifest.json`
  - Add Gemini host matching to content script matches.
  - Add `src/adapters/gemini-adapter.js` before `src/content/content-script.js`.
- Modify `src/adapters/adapter-contract.js`
  - Require `getLifecycleBridgeConfig`.
- Modify `src/adapters/chatgpt-adapter.js`
  - Add ChatGPT bridge config.
  - Keep existing ChatGPT behavior unchanged.
- Create `src/adapters/gemini-adapter.js`
  - Match `gemini.google.com`.
  - Detect send actions and prompt drafts.
  - Normalize lifecycle events for Gemini.
  - Return Gemini bridge config.
- Modify `src/content/page-lifecycle-bridge.js`
  - Replace ChatGPT-only matching with active bridge config.
  - Keep ChatGPT prompt extraction.
  - Add Gemini prompt extraction.
- Modify `src/content/content-script.js`
  - Register ChatGPT and Gemini adapters.
  - Send bridge config to page bridge.
  - Emit metadata-only diagnostic messages.
- Modify `src/shared/messages.js`
  - Add a diagnostic event message type and creator.
- Modify `src/background/service-worker.js`
  - Store and return diagnostics as part of popup status.
  - Record notification and focus diagnostics.
- Modify `src/popup/popup.html`
  - Add recent activity markup.
- Modify `src/popup/popup.js`
  - Render diagnostics timeline.
  - Treat ChatGPT and Gemini as supported pages.
- Modify `src/popup/popup.css`
  - Style recent activity compactly.
- Modify tests:
  - `tests/chatgpt-adapter.test.js`
  - `tests/gemini-adapter.test.js`
  - `tests/adapter-contract.test.js`
  - `tests/page-lifecycle-bridge.test.js`
  - `tests/content-script.test.js`
  - `tests/background.test.js`
  - `tests/popup.test.js`
  - `tests/manifest.test.js`
  - `tests/messages.test.js`
- Modify docs after implementation:
  - `README.md`
  - `README.zh-CN.md`
  - `docs/INSTALL.md`
  - `docs/TROUBLESHOOTING.md`

## Task 1: Extend Adapter Contract And ChatGPT Bridge Config

**Files:**
- Modify: `src/adapters/adapter-contract.js`
- Modify: `src/adapters/chatgpt-adapter.js`
- Test: `tests/chatgpt-adapter.test.js`
- Test: `tests/adapter-contract.test.js`

- [ ] **Step 1: Add failing contract test**

Create or update `tests/adapter-contract.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAdapter, REQUIRED_ADAPTER_METHODS } = require("../src/adapters/adapter-contract.js");

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
```

- [ ] **Step 2: Add failing ChatGPT config test**

Add to `tests/chatgpt-adapter.test.js`:

```js
test("returns ChatGPT lifecycle bridge config", () => {
  const adapter = createChatGptAdapter();
  const config = adapter.getLifecycleBridgeConfig();

  assert.deepEqual(config.hosts, ["chatgpt.com", "chat.openai.com"]);
  assert.equal(config.siteId, "chatgpt");
  assert.equal(config.promptExtractor, "chatgpt");
  assert.ok(
    config.generationRequestMatchers.some((matcher) => matcher.pathname === "/backend-api/f/conversation")
  );
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test tests/adapter-contract.test.js tests/chatgpt-adapter.test.js
```

Expected:

- Fails because `getLifecycleBridgeConfig` is not required.
- Fails because ChatGPT adapter does not expose `getLifecycleBridgeConfig`.

- [ ] **Step 4: Implement adapter contract update**

In `src/adapters/adapter-contract.js`, add the new required method:

```js
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
  "getLifecycleBridgeConfig",
]);
```

- [ ] **Step 5: Implement ChatGPT bridge config**

In `src/adapters/chatgpt-adapter.js`, add:

```js
function getLifecycleBridgeConfig() {
  return {
    siteId: "chatgpt",
    hosts: Array.from(CHATGPT_HOSTS),
    generationRequestMatchers: Array.from(GENERATION_URL_PATHS).map((pathname) => ({ pathname })),
    promptExtractor: "chatgpt",
  };
}
```

Return it from the adapter object:

```js
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
  getLifecycleBridgeConfig,
};
```

- [ ] **Step 6: Run task tests**

Run:

```bash
node --test tests/adapter-contract.test.js tests/chatgpt-adapter.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/adapters/adapter-contract.js src/adapters/chatgpt-adapter.js tests/adapter-contract.test.js tests/chatgpt-adapter.test.js
git commit -m "feat: add lifecycle bridge adapter config"
```

## Task 2: Add Gemini Adapter And Manifest Support

**Files:**
- Create: `src/adapters/gemini-adapter.js`
- Modify: `manifest.json`
- Test: `tests/gemini-adapter.test.js`
- Test: `tests/manifest.test.js`

- [ ] **Step 1: Add failing Gemini adapter tests**

Create `tests/gemini-adapter.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeminiAdapter } = require("../src/adapters/gemini-adapter.js");
const { validateAdapter } = require("../src/adapters/adapter-contract.js");

function createElementEvent(type, element, extra = {}) {
  return Object.assign({ type, target: element }, extra);
}

test("matches regular Gemini web app host", () => {
  const adapter = createGeminiAdapter({ tempKeySeed: () => "seed" });

  assert.equal(adapter.matchesLocation(new URL("https://gemini.google.com/app")), true);
  assert.equal(adapter.matchesLocation(new URL("https://gemini.google.com/u/0/app/abc")), true);
  assert.equal(adapter.matchesLocation(new URL("https://example.com/app")), false);
});

test("satisfies adapter contract", () => {
  assert.equal(validateAdapter(createGeminiAdapter()), true);
});

test("extracts stable session key from Gemini app URL when present", () => {
  const adapter = createGeminiAdapter({ tempKeySeed: () => "seed" });

  assert.equal(
    adapter.getSessionKey(new URL("https://gemini.google.com/app/123abc")),
    "conversation:123abc"
  );
  assert.equal(
    adapter.getSessionKey(new URL("https://gemini.google.com/u/0/app/456def")),
    "conversation:456def"
  );
});

test("uses temporary Gemini session key when URL has no conversation id", () => {
  const adapter = createGeminiAdapter({ tempKeySeed: () => "seed" });

  assert.equal(adapter.getSessionKey(new URL("https://gemini.google.com/app")), "temp:gemini:seed");
  assert.equal(adapter.getSessionKey(new URL("https://gemini.google.com/app")), "temp:gemini:seed");
});

test("recognizes Gemini send actions", () => {
  const adapter = createGeminiAdapter();
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Send message");
  const icon = document.createElement("span");
  button.appendChild(icon);

  assert.equal(adapter.isSendEvent(createElementEvent("click", icon)), true);
  assert.equal(adapter.isSendEvent({ type: "keydown", key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(adapter.isSendEvent({ type: "keydown", key: "Enter", shiftKey: true, isComposing: false }), false);
});

test("reads Gemini prompt draft", () => {
  const adapter = createGeminiAdapter();
  const root = document.createElement("main");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.textContent = "Explain Kubernetes simply";
  root.appendChild(editor);

  assert.equal(adapter.getPromptDraft(root), "Explain Kubernetes simply");
});

test("returns Gemini lifecycle bridge config", () => {
  const adapter = createGeminiAdapter();
  const config = adapter.getLifecycleBridgeConfig();

  assert.equal(config.siteId, "gemini");
  assert.deepEqual(config.hosts, ["gemini.google.com"]);
  assert.equal(config.promptExtractor, "gemini");
  assert.ok(config.generationRequestMatchers.some((matcher) => matcher.pathnameIncludes === "StreamGenerate"));
});

test("normalizes Gemini lifecycle events", () => {
  const adapter = createGeminiAdapter();
  const normalized = adapter.normalizeLifecycleEvent({
    siteId: "gemini",
    phase: "completed",
    lifecycleId: "fetch:1",
    url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    method: "POST",
    promptExcerpt: "Explain Kubernetes simply",
  });

  assert.deepEqual(normalized, {
    type: "GENERATION_COMPLETED",
    lifecycleId: "fetch:1",
    url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    method: "POST",
    promptExcerpt: "Explain Kubernetes simply",
  });
});
```

- [ ] **Step 2: Add failing manifest test**

Update `tests/manifest.test.js` to assert:

```js
test("manifest supports Gemini content script loading", () => {
  const manifest = readManifest();
  const scripts = manifest.content_scripts[0];

  assert.ok(scripts.matches.includes("https://gemini.google.com/*"));
  assert.ok(scripts.js.includes("src/adapters/gemini-adapter.js"));
  assert.ok(
    scripts.js.indexOf("src/adapters/gemini-adapter.js") <
      scripts.js.indexOf("src/content/content-script.js")
  );
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test tests/gemini-adapter.test.js tests/manifest.test.js
```

Expected:

- Fails because `src/adapters/gemini-adapter.js` does not exist.
- Fails because manifest does not include Gemini host/script.

- [ ] **Step 4: Implement Gemini adapter**

Create `src/adapters/gemini-adapter.js`:

```js
(function attachGeminiAdapter(root, factory) {
  const existing = root.ChatNotify || {};
  const domWatch =
    existing.observeDom || typeof require !== "function" ? existing : require("../core/dom-watch.js");
  const exports = factory(domWatch);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildGeminiAdapter(domWatch) {
  const GEMINI_HOSTS = new Set(["gemini.google.com"]);
  const PROMPT_SELECTOR = [
    "[contenteditable='true']",
    "rich-textarea [contenteditable='true']",
    "textarea",
  ].join(",");
  const USER_SELECTOR = [
    "[data-test-id='user-query']",
    "[data-message-author-role='user']",
  ].join(",");
  const ASSISTANT_SELECTOR = [
    "[data-test-id='response']",
    "[data-message-author-role='assistant']",
  ].join(",");
  const SEND_LABEL_PATTERN = /send|发送/i;
  const STOP_LABEL_PATTERN = /stop|cancel|停止|取消/i;
  const PHASE_EVENT_TYPES = Object.freeze({
    started: "GENERATION_STARTED",
    completed: "GENERATION_COMPLETED",
    canceled: "GENERATION_CANCELED",
    failed: "GENERATION_FAILED",
  });
  const STREAM_GENERATE_PATH_PART = "StreamGenerate";

  function defaultTempKeySeed() {
    return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  function textOf(element) {
    if (!element) {
      return "";
    }
    const value = typeof element.value === "string" ? element.value : element.textContent;
    return typeof value === "string" ? value.trim() : "";
  }

  function lastElement(elements) {
    return elements.length > 0 ? elements[elements.length - 1] : null;
  }

  function findLatestBySelector(root, selector) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return "";
    }
    return textOf(lastElement(Array.from(root.querySelectorAll(selector))));
  }

  function isSendButton(element) {
    if (!element || typeof element.closest !== "function") {
      return false;
    }
    const button = element.closest("button");
    if (!button) {
      return false;
    }
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
    const dataTestId = button.getAttribute("data-test-id") || button.getAttribute("data-testid") || "";
    return SEND_LABEL_PATTERN.test(label) || /send/i.test(dataTestId);
  }

  function buttonHasStopIntent(button) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
    const dataTestId = button.getAttribute("data-test-id") || button.getAttribute("data-testid") || "";
    return STOP_LABEL_PATTERN.test(label) || /stop|cancel/i.test(dataTestId);
  }

  function isGenerationUrl(url) {
    try {
      const parsed = new URL(url);
      return GEMINI_HOSTS.has(parsed.hostname) && parsed.pathname.includes(STREAM_GENERATE_PATH_PART);
    } catch (_error) {
      return false;
    }
  }

  function createGeminiAdapter(options = {}) {
    const tempKeySeed = typeof options.tempKeySeed === "function" ? options.tempKeySeed : defaultTempKeySeed;
    let temporarySessionKey = "";
    const observeDom =
      typeof options.observeDom === "function"
        ? options.observeDom
        : domWatch && typeof domWatch.observeDom === "function"
          ? domWatch.observeDom
          : () => () => {};

    function matchesLocation(location) {
      return Boolean(location && GEMINI_HOSTS.has(location.hostname));
    }

    function getSessionKey(location) {
      const pathname = location && typeof location.pathname === "string" ? location.pathname : "";
      const match = pathname.match(/\/app\/([^/?#]+)/);
      if (match) {
        return `conversation:${decodeURIComponent(match[1])}`;
      }
      if (!temporarySessionKey) {
        temporarySessionKey = `temp:gemini:${tempKeySeed()}`;
      }
      return temporarySessionKey;
    }

    function isSendEvent(event) {
      if (!event || typeof event !== "object") {
        return false;
      }
      if (event.type === "click") {
        return isSendButton(event.target);
      }
      if (event.type === "keydown") {
        return event.key === "Enter" && !event.shiftKey && !event.isComposing;
      }
      return false;
    }

    function getPromptDraft(root) {
      if (!root || typeof root.querySelector !== "function") {
        return "";
      }
      return textOf(root.querySelector(PROMPT_SELECTOR));
    }

    function getLatestUserMessage(root) {
      return findLatestBySelector(root, USER_SELECTOR);
    }

    function isResponding(root) {
      if (!root || typeof root.querySelectorAll !== "function") {
        return false;
      }
      return Array.from(root.querySelectorAll("button")).some(buttonHasStopIntent);
    }

    function getLatestAssistantSnapshot(root) {
      return findLatestBySelector(root, ASSISTANT_SELECTOR);
    }

    function observePage(root, callback) {
      return observeDom(root, callback);
    }

    function normalizeLifecycleEvent(event) {
      if (!event || event.siteId !== "gemini" || !PHASE_EVENT_TYPES[event.phase] || !isGenerationUrl(event.url)) {
        return null;
      }
      const normalized = {
        type: PHASE_EVENT_TYPES[event.phase],
        lifecycleId: event.lifecycleId || "",
        url: event.url || "",
        method: event.method || "",
      };
      if (typeof event.promptExcerpt === "string" && event.promptExcerpt.trim()) {
        normalized.promptExcerpt = event.promptExcerpt.trim();
      }
      return normalized;
    }

    function getLifecycleBridgeConfig() {
      return {
        siteId: "gemini",
        hosts: Array.from(GEMINI_HOSTS),
        generationRequestMatchers: [
          { pathnameIncludes: STREAM_GENERATE_PATH_PART },
        ],
        promptExtractor: "gemini",
      };
    }

    return {
      siteId: "gemini",
      displayName: "Gemini",
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
      getLifecycleBridgeConfig,
    };
  }

  return {
    createGeminiAdapter,
  };
});
```

- [ ] **Step 5: Update manifest**

In `manifest.json`:

- Add `"https://gemini.google.com/*"` to `content_scripts[0].matches`.
- Add `"src/adapters/gemini-adapter.js"` after `"src/adapters/chatgpt-adapter.js"` and before `"src/content/content-script.js"`.

- [ ] **Step 6: Run task tests**

Run:

```bash
node --test tests/gemini-adapter.test.js tests/manifest.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add manifest.json src/adapters/gemini-adapter.js tests/gemini-adapter.test.js tests/manifest.test.js
git commit -m "feat: add gemini adapter"
```

## Task 3: Make Lifecycle Bridge Config-Driven

**Files:**
- Modify: `src/content/page-lifecycle-bridge.js`
- Modify: `src/content/content-script.js`
- Test: `tests/page-lifecycle-bridge.test.js`
- Test: `tests/content-script.test.js`

- [ ] **Step 1: Add failing bridge config tests**

Add to `tests/page-lifecycle-bridge.test.js`:

```js
test("matches configured Gemini generation requests", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  bridge.listeners.get("message")({
    source: bridge.window,
    data: {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: {
        siteId: "gemini",
        hosts: ["gemini.google.com"],
        generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
        promptExtractor: "gemini",
      },
    },
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: JSON.stringify([[[["Explain Kubernetes simply"]]]]),
  });

  assert.equal(bridge.details()[0].siteId, "gemini");
  assert.equal(bridge.details()[0].phase, "started");
  assert.equal(bridge.details()[0].promptExcerpt, "Explain Kubernetes simply");
  assert.equal(bridge.details().at(-1).phase, "completed");
});

test("ignores fetches until bridge config is received", async () => {
  const bridge = createBridgeWindow({
    location: "https://gemini.google.com/app",
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  await bridge.window.fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", {
    method: "POST",
    body: JSON.stringify([[[["Explain Kubernetes simply"]]]]),
  });

  assert.equal(bridge.details().length, 0);
});
```

Preserve current ChatGPT tests by making them install a ChatGPT bridge config before calling `fetch`.

- [ ] **Step 2: Add failing content script config test**

Add to `tests/content-script.test.js`:

```js
test("sends selected adapter lifecycle bridge config after bridge injection", async () => {
  const context = createContentScriptContext({
    enabled: true,
  });
  context.documentFixture.scripts[0].onload();

  const messages = context.postedMessages
    .map((entry) => entry.message)
    .filter((message) => message.type === "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].config.siteId, "chatgpt");
  assert.equal(messages[0].config.promptExtractor, "chatgpt");
});

test("registers Gemini adapter in content script", () => {
  const geminiAdapter = {
    siteId: "gemini",
    displayName: "Gemini",
    canObserveLifecycle: true,
    matchesLocation: (location) => location.hostname === "gemini.google.com",
    isSendEvent: () => false,
    normalizeLifecycleEvent: () => null,
    getLifecycleBridgeConfig: () => ({
      siteId: "gemini",
      hosts: ["gemini.google.com"],
      generationRequestMatchers: [{ pathnameIncludes: "StreamGenerate" }],
      promptExtractor: "gemini",
    }),
  };
  const context = createContentScriptContext({
    supported: false,
    location: "https://gemini.google.com/app",
    extraApi: {
      createGeminiAdapter: () => geminiAdapter,
    },
  });

  assert.equal(context.adapter.siteId, "gemini");
});
```

To support this test, update `createContentScriptContext` in `tests/content-script.test.js` so it accepts:

```js
function createContentScriptContext({
  enabled = true,
  debugLogs = false,
  supported = true,
  location = "https://chatgpt.com/c/test",
  extraApi = {},
  consoleApi = console,
} = {}) {
```

Then use `location` for `window.location` and merge `extraApi` into `api`:

```js
const window = {
  location: new URL(location),
  // existing fields stay unchanged
};

const api = Object.assign({
  createChatGptAdapter: () => adapter,
  createMonitorController: (options) => {
    // existing implementation
  },
  createResponseCompletedMessage: (event) => ({ type: "AI_RESPONSE_COMPLETED", payload: event }),
}, extraApi);
```

Also add a default fake adapter method:

```js
getLifecycleBridgeConfig: () => ({
  siteId: "chatgpt",
  hosts: ["chatgpt.com", "chat.openai.com"],
  generationRequestMatchers: [{ pathname: "/backend-api/f/conversation" }],
  promptExtractor: "chatgpt",
}),
```

And expose the selected adapter from context by returning:

```js
adapter: controllerOptions && controllerOptions.adapter,
```

instead of always returning the original fake ChatGPT adapter.

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test tests/page-lifecycle-bridge.test.js tests/content-script.test.js
```

Expected:

- Fails because the bridge still uses hard-coded ChatGPT matching.
- Fails because content script does not send bridge config.

- [ ] **Step 4: Implement bridge config message handling**

In `src/content/page-lifecycle-bridge.js`, add:

```js
let bridgeConfig = null;

function sanitizeBridgeConfig(config) {
  if (!config || typeof config !== "object" || typeof config.siteId !== "string") {
    return null;
  }
  const hosts = Array.isArray(config.hosts) ? config.hosts.filter((host) => typeof host === "string") : [];
  const matchers = Array.isArray(config.generationRequestMatchers)
    ? config.generationRequestMatchers.filter((matcher) => matcher && typeof matcher === "object")
    : [];
  if (!hosts.length || !matchers.length) {
    return null;
  }
  return {
    siteId: config.siteId,
    hosts,
    generationRequestMatchers: matchers.map((matcher) => ({
      pathname: typeof matcher.pathname === "string" ? matcher.pathname : "",
      pathnameIncludes: typeof matcher.pathnameIncludes === "string" ? matcher.pathnameIncludes : "",
    })),
    promptExtractor: config.promptExtractor === "gemini" ? "gemini" : "chatgpt",
  };
}
```

In the existing `window.addEventListener("message", ...)`, handle:

```js
if (data.source === "chat-notify-content-script" && data.type === "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG") {
  const nextConfig = sanitizeBridgeConfig(data.config);
  if (nextConfig) {
    bridgeConfig = nextConfig;
    log("info", "page lifecycle bridge config changed", { siteId: bridgeConfig.siteId });
  }
  return;
}
```

- [ ] **Step 5: Replace URL matching**

Replace hard-coded ChatGPT URL constants and `getNormalizedUrl` with:

```js
function matcherMatchesPath(matcher, pathname) {
  if (matcher.pathname && pathname === matcher.pathname) {
    return true;
  }
  if (matcher.pathnameIncludes && pathname.includes(matcher.pathnameIncludes)) {
    return true;
  }
  return false;
}

function getNormalizedUrl(input) {
  if (!bridgeConfig) {
    return "";
  }
  const url = getInputUrl(input);
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url, window.location.href);
    if (!bridgeConfig.hosts.includes(parsed.hostname)) {
      return "";
    }
    if (!bridgeConfig.generationRequestMatchers.some((matcher) => matcherMatchesPath(matcher, parsed.pathname))) {
      return "";
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_error) {
    return "";
  }
}
```

- [ ] **Step 6: Add Gemini prompt extraction**

Keep existing ChatGPT JSON extraction as `extractChatGptPromptExcerpt`. Add:

```js
function collectStrings(value, result) {
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, result));
  }
}

function extractGeminiPromptExcerpt(input, init) {
  const body = getRequestBody(input, init);
  if (!body || body.length > 200000) {
    return "";
  }
  try {
    const parsed = JSON.parse(body);
    const strings = [];
    collectStrings(parsed, strings);
    const candidate = strings.find((value) => {
      const trimmed = value.trim();
      return trimmed.length > 0 && !/^https?:\/\//i.test(trimmed) && !/^\d+$/.test(trimmed);
    });
    return createPromptExcerpt(candidate || "");
  } catch (_error) {
    return createPromptExcerpt(body);
  }
}

function extractPromptExcerpt(input, init) {
  if (!bridgeConfig) {
    return "";
  }
  if (bridgeConfig.promptExtractor === "gemini") {
    return extractGeminiPromptExcerpt(input, init);
  }
  return extractChatGptPromptExcerpt(input, init);
}
```

Ensure posted lifecycle details include `siteId: bridgeConfig.siteId`.

- [ ] **Step 7: Send bridge config from content script**

In `src/content/content-script.js`, add:

```js
function postBridgeConfig() {
  if (!adapter.canObserveLifecycle || typeof adapter.getLifecycleBridgeConfig !== "function") {
    return;
  }
  window.postMessage(
    {
      source: "chat-notify-content-script",
      type: "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG",
      config: adapter.getLifecycleBridgeConfig(),
    },
    window.location.origin
  );
}
```

Call `postBridgeConfig()` after script load and before or alongside `postDebugStateToBridge()`:

```js
script.onload = () => {
  log("info", "page lifecycle bridge injected");
  postBridgeConfig();
  postDebugStateToBridge();
  script.remove();
};
```

- [ ] **Step 8: Run task tests**

Run:

```bash
node --test tests/page-lifecycle-bridge.test.js tests/content-script.test.js tests/chatgpt-adapter.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/content/page-lifecycle-bridge.js src/content/content-script.js tests/page-lifecycle-bridge.test.js tests/content-script.test.js tests/chatgpt-adapter.test.js
git commit -m "feat: configure lifecycle bridge per adapter"
```

## Task 4: Add Diagnostics Messages And Background Storage

**Files:**
- Modify: `src/shared/messages.js`
- Modify: `src/background/service-worker.js`
- Modify: `src/content/content-script.js`
- Test: `tests/messages.test.js`
- Test: `tests/background.test.js`
- Test: `tests/content-script.test.js`

- [ ] **Step 1: Add failing message tests**

Add to `tests/messages.test.js`:

```js
test("createDiagnosticEventMessage creates sanitized diagnostic event", () => {
  const message = createDiagnosticEventMessage({
    flowId: "chatgpt:123:1",
    siteId: "chatgpt",
    displayName: "ChatGPT",
    promptExcerpt: "Explain Kubernetes simply",
    eventType: "send_captured",
    status: "ok",
    message: "captured",
    sessionKey: "conversation:secret",
    url: "https://chatgpt.com/c/secret",
  });

  assert.equal(message.type, MESSAGE_TYPES.DIAGNOSTIC_EVENT);
  assert.equal(message.payload.flowId, "chatgpt:123:1");
  assert.equal(message.payload.promptExcerpt, "Explain Kubernetes simply");
  assert.equal(message.payload.eventType, "send_captured");
  assert.equal(message.payload.sessionKey, undefined);
  assert.equal(message.payload.url, undefined);
});

test("createResponseCompletedMessage carries flow id without changing notification content fields", () => {
  const message = createResponseCompletedMessage({
    siteId: "gemini",
    displayName: "Gemini",
    sessionKey: "conversation:secret",
    sourceTabId: 12,
    promptExcerpt: "Explain Kubernetes simply",
    completedAt: 1780761600000,
    flowId: "gemini:1780761600000:1",
  });

  assert.equal(message.payload.flowId, "gemini:1780761600000:1");
  assert.equal(message.payload.siteId, "gemini");
  assert.equal(message.payload.promptExcerpt, "Explain Kubernetes simply");
});
```

- [ ] **Step 2: Add failing background diagnostics tests**

Add to `tests/background.test.js`:

```js
test("records diagnostic event and returns it in popup status", async () => {
  const { service } = createServiceHarness();

  await service.handleMessage(createDiagnosticEventMessage({
    flowId: "gemini:1780761600000:1",
    siteId: "gemini",
    displayName: "Gemini",
    promptExcerpt: "Explain Kubernetes simply",
    eventType: "send_captured",
    status: "ok",
  }));

  const response = await service.handleMessage({ type: MESSAGE_TYPES.GET_POPUP_STATUS });

  assert.equal(response.ok, true);
  assert.equal(response.popupStatus.diagnostics.latestFlow.siteId, "gemini");
  assert.equal(response.popupStatus.diagnostics.latestFlow.events[0].type, "send_captured");
});

test("bounds diagnostic events and excludes raw session metadata", async () => {
  const { service } = createServiceHarness();

  for (let index = 0; index < 10; index += 1) {
    await service.handleMessage(createDiagnosticEventMessage({
      flowId: "chatgpt:1780761600000:1",
      siteId: "chatgpt",
      displayName: "ChatGPT",
      promptExcerpt: "Explain Kubernetes simply",
      eventType: `event_${index}`,
      status: "ok",
      sessionKey: "conversation:secret",
    }));
  }

  const response = await service.handleMessage({ type: MESSAGE_TYPES.GET_POPUP_STATUS });
  const latestFlow = response.popupStatus.diagnostics.latestFlow;

  assert.equal(latestFlow.events.length, 8);
  assert.equal(latestFlow.sessionKey, undefined);
  assert.equal(latestFlow.events[0].type, "event_2");
});
```

- [ ] **Step 3: Add failing content diagnostic test**

Add to `tests/content-script.test.js`:

```js
test("reports diagnostic events for send capture and lifecycle phases", () => {
  const context = createContentScriptContext();

  context.documentFixture.listeners.get("click").listener({ isSend: true });
  context.windowListeners.get("message")({
    source: context.window,
    data: {
      source: "chat-notify-page-lifecycle-bridge",
      detail: {
        normalized: {
          type: "GENERATION_STARTED",
          lifecycleId: "life-1",
          promptExcerpt: "Explain Kubernetes simply",
        },
      },
    },
  });

  const diagnosticMessages = context.sentMessages.filter(
    (message) => message.type === "DIAGNOSTIC_EVENT"
  );

  assert.ok(diagnosticMessages.some((message) => message.payload.eventType === "send_captured"));
  assert.ok(diagnosticMessages.some((message) => message.payload.eventType === "lifecycle_started"));
  assert.ok(diagnosticMessages.every((message) => message.payload.sessionKey === undefined));
});
```

To support this test, add to the fake `api` in `createContentScriptContext`:

```js
createDiagnosticEventMessage: (event) => ({
  type: "DIAGNOSTIC_EVENT",
  payload: {
    flowId: event.flowId,
    siteId: event.siteId,
    displayName: event.displayName,
    promptExcerpt: event.promptExcerpt || "",
    eventType: event.eventType,
    status: event.status,
    message: event.message || "",
  },
}),
```

- [ ] **Step 4: Run failing tests**

Run:

```bash
node --test tests/messages.test.js tests/background.test.js tests/content-script.test.js
```

Expected:

- Fails because diagnostic message type/creator do not exist.
- Fails because background does not store diagnostics.
- Fails because content script does not report diagnostics.

- [ ] **Step 5: Implement diagnostic message creator**

In `src/shared/messages.js`, add `DIAGNOSTIC_EVENT` to `MESSAGE_TYPES` and add:

```js
function createDiagnosticEventMessage(input = {}) {
  return {
    type: MESSAGE_TYPES.DIAGNOSTIC_EVENT,
    payload: {
      flowId: typeof input.flowId === "string" ? input.flowId : "",
      siteId: typeof input.siteId === "string" ? input.siteId : "",
      displayName: typeof input.displayName === "string" ? input.displayName : "",
      promptExcerpt: createPromptExcerpt(input.promptExcerpt || ""),
      eventType: typeof input.eventType === "string" ? input.eventType : "",
      status: input.status === "failed" ? "failed" : "ok",
      message: typeof input.message === "string" ? input.message.split("\n")[0].trim() : "",
    },
  };
}
```

Export `createDiagnosticEventMessage`.

Also extend `createResponseCompletedMessage` to carry `flowId`:

```js
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
      flowId: cleanString(input.flowId),
    },
  };
}
```

- [ ] **Step 6: Implement background diagnostics storage**

In `src/background/service-worker.js`:

- Add default diagnostics to `DEFAULT_POPUP_STATUS`.
- Add `DIAGNOSTIC_EVENT_LIMIT = 8`.
- Add helpers:

```js
function createEmptyDiagnostics() {
  return { latestFlow: null };
}

function cloneDiagnostics(diagnostics) {
  if (!diagnostics || !diagnostics.latestFlow) {
    return createEmptyDiagnostics();
  }
  return {
    latestFlow: {
      flowId: diagnostics.latestFlow.flowId || "",
      siteId: diagnostics.latestFlow.siteId || "",
      displayName: diagnostics.latestFlow.displayName || "",
      promptExcerpt: diagnostics.latestFlow.promptExcerpt || "",
      updatedAt: Number.isFinite(diagnostics.latestFlow.updatedAt) ? diagnostics.latestFlow.updatedAt : null,
      events: Array.isArray(diagnostics.latestFlow.events)
        ? diagnostics.latestFlow.events.slice(-DIAGNOSTIC_EVENT_LIMIT).map((event) => ({
            type: event.type || "",
            status: event.status === "failed" ? "failed" : "ok",
            at: Number.isFinite(event.at) ? event.at : null,
            message: event.message || "",
          }))
        : [],
    },
  };
}
```

Update `clonePopupStatus` and `patchPopupStatus` to preserve `diagnostics`.

Handle `MESSAGE_TYPES.DIAGNOSTIC_EVENT` in `handleMessage`:

```js
if (message && message.type === MESSAGE_TYPES.DIAGNOSTIC_EVENT) {
  const payload = message.payload || {};
  const current = await getPopupStatus();
  const previousFlow = current.diagnostics && current.diagnostics.latestFlow;
  const sameFlow = previousFlow && previousFlow.flowId === payload.flowId;
  const events = sameFlow ? previousFlow.events.slice() : [];
  events.push({
    type: payload.eventType || "",
    status: payload.status === "failed" ? "failed" : "ok",
    at: now(),
    message: payload.message || "",
  });
  await setPopupStatus(Object.assign({}, current, {
    diagnostics: {
      latestFlow: {
        flowId: payload.flowId || `flow:${now()}`,
        siteId: payload.siteId || "",
        displayName: payload.displayName || "",
        promptExcerpt: payload.promptExcerpt || "",
        updatedAt: now(),
        events: events.slice(-DIAGNOSTIC_EVENT_LIMIT),
      },
    },
  }));
  return { ok: true };
}
```

- [ ] **Step 7: Report diagnostics from content script**

In `src/content/content-script.js`, add:

```js
let flowCounter = 0;
let currentFlowId = "";

function createFlowId() {
  flowCounter += 1;
  return `${adapter.siteId}:${Date.now()}:${flowCounter}`;
}

function sendDiagnosticEvent(eventType, status, detail = {}) {
  if (!enabled || !api.createDiagnosticEventMessage) {
    return;
  }
  chrome.runtime.sendMessage(api.createDiagnosticEventMessage({
    flowId: currentFlowId || createFlowId(),
    siteId: adapter.siteId,
    displayName: adapter.displayName,
    promptExcerpt: detail.promptExcerpt || "",
    eventType,
    status: status || "ok",
    message: detail.message || "",
  }));
}
```

In `handlePossibleSend`, set `currentFlowId` before sending diagnostics:

```js
currentFlowId = createFlowId();
sendDiagnosticEvent("send_captured", "ok", {
  promptExcerpt: adapter.getPromptDraft(document),
});
```

In `sendCompletion`, include the current flow id:

```js
chrome.runtime.sendMessage(api.createResponseCompletedMessage(Object.assign({}, event, {
  flowId: currentFlowId,
})), (response) => {
  const lastError = chrome.runtime && chrome.runtime.lastError;
  if (lastError) {
    log("warn", "completion message failed", lastError.message || String(lastError));
    return;
  }
  log("info", "completion message acknowledged", response);
});
```

In `handleLifecycleMessage`, after normalizing:

```js
const diagnosticTypeByLifecycleType = {
  GENERATION_STARTED: "lifecycle_started",
  GENERATION_COMPLETED: "lifecycle_completed",
  GENERATION_FAILED: "lifecycle_failed",
  GENERATION_CANCELED: "lifecycle_canceled",
};
if (diagnosticTypeByLifecycleType[normalized.type]) {
  sendDiagnosticEvent(
    diagnosticTypeByLifecycleType[normalized.type],
    normalized.type === "GENERATION_FAILED" ? "failed" : "ok",
    { promptExcerpt: normalized.promptExcerpt || "" }
  );
}
```

- [ ] **Step 8: Record notification diagnostics in background**

In `handleMessage`, after completion notification success:

```js
await recordDiagnosticEvent({
  flowId: payload.flowId || "",
  siteId: payload.siteId || "",
  displayName: payload.displayName || "",
  promptExcerpt: payload.promptExcerpt || "",
  eventType: "notification_sent",
  status: "ok",
});
```

After notification failure, record `notification_failed` with `status: "failed"` and a short message.

In `handleNotificationClicked`, record `notification_focus_succeeded` or `notification_focus_failed` when enough target metadata is available. Keep records metadata-only.

When storing notification targets, include the non-sensitive `flowId`, `siteId`, `displayName`, and `promptExcerpt` so click diagnostics can append to the same flow. Do not store `sessionKey` or URL in notification targets.

- [ ] **Step 9: Run task tests**

Run:

```bash
node --test tests/messages.test.js tests/background.test.js tests/content-script.test.js
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/shared/messages.js src/background/service-worker.js src/content/content-script.js tests/messages.test.js tests/background.test.js tests/content-script.test.js
git commit -m "feat: record reliability diagnostics"
```

## Task 5: Render Recent Activity In Popup

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.js`
- Modify: `src/popup/popup.css`
- Test: `tests/popup.test.js`

- [ ] **Step 1: Add failing popup tests**

Add to `tests/popup.test.js`:

```js
test("popup renders no recent activity state", async () => {
  const popup = runPopup({
    statusResponse: {
      ok: true,
      popupStatus: {
        notificationHealth: { state: "not_tested", message: "", updatedAt: null },
        lastCompletion: { state: "none", siteId: "", updatedAt: null },
        diagnostics: { latestFlow: null },
      },
    },
  });

  assert.equal(popup.elements["activity-summary"].textContent, "No recent activity");
});

test("popup renders recent activity timeline", async () => {
  const popup = runPopup({
    statusResponse: {
      ok: true,
      popupStatus: {
        notificationHealth: { state: "ok", message: "", updatedAt: 1 },
        lastCompletion: { state: "sent", siteId: "gemini", updatedAt: 2 },
        diagnostics: {
          latestFlow: {
            flowId: "gemini:1:1",
            siteId: "gemini",
            displayName: "Gemini",
            promptExcerpt: "Explain Kubernetes simply",
            updatedAt: 3,
            events: [
              { type: "send_captured", status: "ok", at: 1, message: "" },
              { type: "lifecycle_started", status: "ok", at: 2, message: "" },
              { type: "notification_sent", status: "ok", at: 3, message: "" },
            ],
          },
        },
      },
    },
  });

  assert.equal(popup.elements["activity-site"].textContent, "Gemini");
  assert.equal(popup.elements["activity-prompt"].textContent, "\"Explain Kubernetes simply\"");
  assert.equal(popup.elements["activity-summary"].textContent, "Notification sent");
  assert.match(popup.elements["activity-timeline"].textContent, /Send captured/);
});
```

- [ ] **Step 2: Add failing supported page test for Gemini**

Add to `tests/popup.test.js`:

```js
test("popup marks Gemini as supported", async () => {
  const popup = runPopup({
    tabUrl: "https://gemini.google.com/app",
  });

  assert.equal(popup.elements["site-status"].textContent, "Current page is supported");
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test tests/popup.test.js
```

Expected:

- Fails because recent activity elements do not exist.
- Fails because popup only recognizes ChatGPT.

- [ ] **Step 4: Add popup markup**

In `src/popup/popup.html`, add a compact recent activity section near status rows:

```html
<section class="status-group" aria-label="Recent activity">
  <div class="status-row">
    <span class="status-label">Recent</span>
    <span id="activity-summary" class="status-value">No recent activity</span>
  </div>
  <div id="activity-site" class="status-detail"></div>
  <div id="activity-prompt" class="status-detail"></div>
  <div id="activity-timeline" class="activity-timeline"></div>
</section>
```

- [ ] **Step 5: Implement popup rendering**

In `src/popup/popup.js`, add element references:

```js
const activitySummary = document.getElementById("activity-summary");
const activitySite = document.getElementById("activity-site");
const activityPrompt = document.getElementById("activity-prompt");
const activityTimeline = document.getElementById("activity-timeline");
```

Add label helper:

```js
const ACTIVITY_LABELS = {
  send_captured: "Send captured",
  lifecycle_started: "Generation started",
  lifecycle_completed: "Generation completed",
  lifecycle_failed: "Generation failed",
  lifecycle_canceled: "Generation canceled",
  notification_sent: "Notification sent",
  notification_failed: "Notification failed",
  notification_focus_succeeded: "Notification focused",
  notification_focus_failed: "Focus failed",
};

function eventLabel(type) {
  return ACTIVITY_LABELS[type] || type || "Unknown event";
}

function renderDiagnostics(diagnostics) {
  const latestFlow = diagnostics && diagnostics.latestFlow;
  if (!latestFlow || !Array.isArray(latestFlow.events) || latestFlow.events.length === 0) {
    activitySummary.textContent = "No recent activity";
    activitySite.textContent = "";
    activityPrompt.textContent = "";
    activityTimeline.textContent = "";
    return;
  }
  const lastEvent = latestFlow.events[latestFlow.events.length - 1];
  activitySummary.textContent = eventLabel(lastEvent.type);
  activitySite.textContent = latestFlow.displayName || latestFlow.siteId || "";
  activityPrompt.textContent = latestFlow.promptExcerpt ? `"${latestFlow.promptExcerpt}"` : "";
  activityTimeline.textContent = latestFlow.events.map((event) => eventLabel(event.type)).join(" -> ");
}
```

Call `renderDiagnostics(status && status.diagnostics)` inside `renderPopupStatus`.

Update supported host detection:

```js
const supportedHosts = new Set(["chatgpt.com", "chat.openai.com", "gemini.google.com"]);
const supported = url && supportedHosts.has(url.hostname);
```

- [ ] **Step 6: Add popup styling**

In `src/popup/popup.css`, add:

```css
.activity-timeline {
  color: #5f6368;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 4px;
  word-break: break-word;
}
```

Use existing class names and spacing where available.

- [ ] **Step 7: Run task tests**

Run:

```bash
node --test tests/popup.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/popup/popup.html src/popup/popup.js src/popup/popup.css tests/popup.test.js
git commit -m "feat: show recent monitoring activity in popup"
```

## Task 6: Update Documentation For Gemini And Diagnostics

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Test: `tests/package-metadata.test.js`

- [ ] **Step 1: Add failing docs tests**

Update `tests/package-metadata.test.js` with:

```js
test("README mentions Gemini and diagnostics", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  assert.match(readme, /Gemini/);
  assert.match(readme, /recent activity|diagnostics/i);
});

test("Chinese README mentions Gemini and recent activity diagnostics", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");

  assert.match(readme, /Gemini/);
  assert.match(readme, /最近活动|诊断/);
});

test("troubleshooting guide covers recent activity diagnostics", () => {
  const guide = fs.readFileSync(path.join(repoRoot, "docs", "TROUBLESHOOTING.md"), "utf8");

  assert.match(guide, /Recent activity|最近活动|diagnostics/i);
});
```

- [ ] **Step 2: Run failing docs tests**

Run:

```bash
node --test tests/package-metadata.test.js
```

Expected: fails because docs do not mention Gemini/diagnostics yet.

- [ ] **Step 3: Update docs**

Update docs to say:

- Supported sites now include ChatGPT and Gemini regular web app.
- Popup recent activity shows where the latest monitoring flow reached.
- Diagnostics are local, bounded, and metadata-only.
- If notifications do not appear, check Recent activity first, then enable debug logs for console details.
- Gemini support is MVP and targets `gemini.google.com`.

Do not describe this as a published `v0.2` release.

- [ ] **Step 4: Run docs tests**

Run:

```bash
node --test tests/package-metadata.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md README.zh-CN.md docs/INSTALL.md docs/TROUBLESHOOTING.md tests/package-metadata.test.js
git commit -m "docs: document gemini and diagnostics"
```

## Task 7: Final Verification

**Files:**
- Verify all changed runtime, test, and docs files.

- [ ] **Step 1: Run full automated test suite**

Run:

```bash
npm test
```

Expected:

- All tests pass.
- No skipped test was added for these features.

- [ ] **Step 2: Run package command**

Run:

```bash
npm run package
```

Expected:

- Package command exits 0.
- The generated zip includes `src/adapters/gemini-adapter.js`.
- The generated zip excludes `tests/`, `docs/`, `node_modules/`, `.git/`, and `.DS_Store`.

- [ ] **Step 3: Inspect package contents**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile

zip_path = Path("dist/chat-notify-0.2.0-alpha.1.zip")
with ZipFile(zip_path) as zf:
    names = sorted(zf.namelist())
    assert "src/adapters/gemini-adapter.js" in names
    assert "src/content/page-lifecycle-bridge.js" in names
    forbidden_prefixes = ("tests/", "docs/", "node_modules/", ".git/")
    forbidden = [name for name in names if name.startswith(forbidden_prefixes) or name.endswith(".DS_Store")]
    assert forbidden == [], forbidden
    print("\n".join(names))
PY
```

Expected:

- Prints package file list.
- Raises no assertion.

- [ ] **Step 4: Manual validation checklist**

Ask the user to load the generated package or unpacked extension and validate:

- ChatGPT still sends completion notifications with correct prompt excerpts.
- ChatGPT notification click focuses the source tab.
- Popup Recent activity updates during a ChatGPT flow.
- Gemini `https://gemini.google.com/app` is shown as supported.
- Gemini completion sends a notification with the correct prompt excerpt.
- Gemini notification click focuses the source tab.
- Popup Recent activity updates during a Gemini flow.

- [ ] **Step 5: Final commit check**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected:

- No uncommitted tracked changes.
- Only ignored package output may exist.
- Recent commits correspond to Tasks 1-6.
