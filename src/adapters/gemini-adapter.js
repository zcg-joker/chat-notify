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
  const GENERATION_PATH_PARTS = Object.freeze([
    "StreamGenerate",
    "BardFrontendService",
  ]);

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
      if (!GEMINI_HOSTS.has(parsed.hostname)) {
        return false;
      }
      return GENERATION_PATH_PARTS.some((part) => parsed.pathname.includes(part)) ||
        (parsed.pathname.includes("BardChatUi") && parsed.pathname.includes("batchexecute"));
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
        generationRequestMatchers: GENERATION_PATH_PARTS
          .map((part) => ({ pathnameIncludes: part }))
          .concat([{ pathnameIncludes: "BardChatUi/data/batchexecute" }]),
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
