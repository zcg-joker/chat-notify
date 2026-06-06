(function attachChatGptAdapter(root, factory) {
  const existing = root.ChatNotify || {};
  const domWatch =
    existing.observeDom || typeof require !== "function" ? existing : require("../core/dom-watch.js");
  const exports = factory(domWatch);
  root.ChatNotify = Object.assign({}, existing, exports);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  }
})(globalThis, function buildChatGptAdapter(domWatch) {
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const MESSAGE_SELECTOR = [
    "[data-message-author-role]",
    '[data-testid="conversation-turn"]',
    '[data-testid^="conversation-turn-"]',
  ].join(",");
  const ASSISTANT_SELECTOR = [
    '[data-message-author-role="assistant"]',
    '[data-testid="conversation-turn"][data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
  ].join(",");
  const USER_SELECTOR = [
    '[data-message-author-role="user"]',
    '[data-testid="conversation-turn"][data-message-author-role="user"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="user"]',
  ].join(",");
  const PROMPT_SELECTOR = "#prompt-textarea, [contenteditable='true'], textarea";
  const STOP_WORDS = ["stop", "cancel"];
  const PHASE_EVENT_TYPES = Object.freeze({
    started: "GENERATION_STARTED",
    completed: "GENERATION_COMPLETED",
    canceled: "GENERATION_CANCELED",
    failed: "GENERATION_FAILED",
  });

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
    const testId = button.getAttribute("data-testid") || "";
    return /send/i.test(label) || /send/i.test(testId);
  }

  function buttonHasStopIntent(button) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
    const normalized = label.toLowerCase();
    return STOP_WORDS.some((word) => normalized.includes(word));
  }

  function createChatGptAdapter(options = {}) {
    const tempKeySeed = typeof options.tempKeySeed === "function" ? options.tempKeySeed : defaultTempKeySeed;
    const observeDom =
      typeof options.observeDom === "function"
        ? options.observeDom
        : domWatch && typeof domWatch.observeDom === "function"
          ? domWatch.observeDom
          : () => () => {};

    function matchesLocation(location) {
      return Boolean(location && CHATGPT_HOSTS.has(location.hostname));
    }

    function getSessionKey(location) {
      const match = location && typeof location.pathname === "string"
        ? location.pathname.match(/^\/c\/([^/?#]+)/)
        : null;
      return match ? `conversation:${decodeURIComponent(match[1])}` : `temp:chatgpt:${tempKeySeed()}`;
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
      return findLatestBySelector(root, ASSISTANT_SELECTOR || MESSAGE_SELECTOR);
    }

    function observePage(root, callback) {
      return observeDom(root, callback);
    }

    function normalizeLifecycleEvent(event) {
      if (!event || !PHASE_EVENT_TYPES[event.phase]) {
        return null;
      }
      return {
        type: PHASE_EVENT_TYPES[event.phase],
        lifecycleId: event.lifecycleId || "",
        url: event.url || "",
        method: event.method || "",
      };
    }

    return {
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
