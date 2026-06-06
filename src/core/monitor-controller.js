(function attachMonitorController(root, factory) {
  const existing = root.ChatNotify || {};
  const dependencies =
    existing.createPromptExcerpt &&
    existing.createResponseStateMachine &&
    existing.createSessionTracker &&
    existing.RESPONSE_STATES
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
  const TERMINAL_STATES = new Set([
    deps.RESPONSE_STATES.CANCELED,
    deps.RESPONSE_STATES.ERROR_OR_UNKNOWN,
  ]);

  function createMonitorController(options = {}) {
    const adapter = options.adapter;
    const root = options.root || (typeof document !== "undefined" ? document : null);
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

    function getCurrentLocation() {
      if (typeof window !== "undefined" && window.location) {
        return window.location;
      }
      return new URL("https://chatgpt.com/");
    }

    function getCurrentSessionKey() {
      return adapter.getSessionKey(getCurrentLocation(), root);
    }

    function isTemporarySessionKey(sessionKey) {
      return typeof sessionKey === "string" && sessionKey.startsWith("temp:");
    }

    function migrateMachine(fromKey, toKey) {
      if (!machines.has(fromKey) || machines.has(toKey)) {
        return;
      }
      machines.set(toKey, machines.get(fromKey));
      machines.delete(fromKey);
    }

    function maybeMigrateToCurrentSessionKey() {
      const currentSessionKey = getCurrentSessionKey();
      if (!currentSessionKey || tracker.get(currentSessionKey) || isTemporarySessionKey(currentSessionKey)) {
        return currentSessionKey;
      }

      const temporarySessions = tracker.list().filter((session) => isTemporarySessionKey(session.sessionKey));
      if (temporarySessions.length !== 1) {
        return currentSessionKey;
      }

      const fromKey = temporarySessions[0].sessionKey;
      if (tracker.migrateSessionKey(fromKey, currentSessionKey)) {
        migrateMachine(fromKey, currentSessionKey);
      }
      return currentSessionKey;
    }

    function capturePromptExcerpt() {
      const promptText = adapter.getPromptDraft(root) || adapter.getLatestUserMessage(root);
      return deps.createPromptExcerpt(promptText);
    }

    function handleUserSend() {
      const sessionKey = getCurrentSessionKey();
      const promptExcerpt = capturePromptExcerpt();

      tracker.upsertPending({
        siteId: adapter.siteId,
        sessionKey,
        sourceTabId: options.sourceTabId,
        promptExcerpt,
        status: deps.RESPONSE_STATES.PENDING_USER_MESSAGE,
      });

      getOrCreateMachine(sessionKey).transition({
        type: "USER_MESSAGE_SENT",
        sessionKey,
      });

      return sessionKey;
    }

    function findSessionForLifecycle(lifecycleEvent) {
      let sessions = tracker.list();
      if (lifecycleEvent.lifecycleId) {
        const matchingLifecycle = sessions.find(
          (session) => session.lifecycleId === lifecycleEvent.lifecycleId
        );
        if (matchingLifecycle) {
          return matchingLifecycle.sessionKey;
        }
      }

      const currentSessionKey = maybeMigrateToCurrentSessionKey();
      const currentRecord = tracker.get(currentSessionKey);
      if (currentRecord && currentRecord.status === deps.RESPONSE_STATES.PENDING_USER_MESSAGE) {
        return currentSessionKey;
      }

      sessions = tracker.list();
      const pendingSessions = sessions.filter(
        (session) => session.status === deps.RESPONSE_STATES.PENDING_USER_MESSAGE
      );
      return pendingSessions.length === 1 ? pendingSessions[0].sessionKey : "";
    }

    function updateTrackerFromResult(sessionKey, lifecycleEvent, result) {
      const patch = {
        status: result.state,
      };

      if (lifecycleEvent.lifecycleId) {
        patch.lifecycleId = lifecycleEvent.lifecycleId;
      }

      tracker.update(sessionKey, patch);
    }

    function removeSession(sessionKey) {
      tracker.remove(sessionKey);
      machines.delete(sessionKey);
    }

    function completeIfNeeded(sessionKey, result) {
      if (!result.shouldNotify) {
        return;
      }

      const record = tracker.get(sessionKey);
      if (!record) {
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
      removeSession(sessionKey);
    }

    function handleLifecycleEvent(lifecycleEvent) {
      if (!lifecycleEvent || !lifecycleEvent.type) {
        return;
      }

      const sessionKey = findSessionForLifecycle(lifecycleEvent);
      if (!sessionKey) {
        return;
      }

      const result = getOrCreateMachine(sessionKey).transition(lifecycleEvent);

      if (TERMINAL_STATES.has(result.state)) {
        removeSession(sessionKey);
        return;
      }

      updateTrackerFromResult(sessionKey, lifecycleEvent, result);
      completeIfNeeded(sessionKey, result);
    }

    function tick() {
      for (const record of tracker.list()) {
        const result = getOrCreateMachine(record.sessionKey).transition({ type: "TICK" });

        if (TERMINAL_STATES.has(result.state)) {
          removeSession(record.sessionKey);
          continue;
        }

        tracker.update(record.sessionKey, {
          status: result.state,
        });
        completeIfNeeded(record.sessionKey, result);
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
