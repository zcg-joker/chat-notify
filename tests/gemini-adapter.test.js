const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeminiAdapter } = require("../src/adapters/gemini-adapter.js");
const { validateAdapter } = require("../src/adapters/adapter-contract.js");

function createElementEvent(type, element, extra = {}) {
  return Object.assign({ type, target: element }, extra);
}

function createElement({ textContent = "" } = {}) {
  const attributes = new Map();
  const children = [];
  const element = {
    textContent,
    value: undefined,
    parentElement: null,
    appendChild(child) {
      child.parentElement = element;
      children.push(child);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) || "";
    },
    closest(selector) {
      let current = element;
      while (current) {
        if (selector === "button" && current.tagName === "BUTTON") {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
  };
  return element;
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
  const button = createElement();
  button.tagName = "BUTTON";
  button.setAttribute("aria-label", "Send message");
  const icon = createElement();
  button.appendChild(icon);

  assert.equal(adapter.isSendEvent(createElementEvent("click", icon)), true);
  assert.equal(adapter.isSendEvent({ type: "keydown", key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(adapter.isSendEvent({ type: "keydown", key: "Enter", shiftKey: true, isComposing: false }), false);
});

test("reads Gemini prompt draft", () => {
  const adapter = createGeminiAdapter();
  const editor = createElement({ textContent: "Explain Kubernetes simply" });
  editor.setAttribute("contenteditable", "true");
  const root = {
    querySelector(selector) {
      return selector.includes("[contenteditable='true']") ? editor : null;
    },
  };

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
