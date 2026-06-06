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
      if (!fromKey || !toKey || fromKey === toKey || !sessions.has(fromKey)) {
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
