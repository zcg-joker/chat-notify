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
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : defaultLimit;
    const characters = Array.from(normalized);

    if (characters.length === 0) {
      return "";
    }

    if (characters.length <= safeLimit) {
      return normalized;
    }

    return `${characters.slice(0, safeLimit - 1).join("")}...`;
  }

  return {
    normalizePromptText,
    createPromptExcerpt,
  };
});
