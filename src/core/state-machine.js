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

  function createResponseStateMachine(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const responseStartTimeoutMs =
      options.responseStartTimeoutMs || DEFAULTS.RESPONSE_START_TIMEOUT_MS;
    const settleMs = options.settleMs || DEFAULTS.RESPONSE_SETTLE_MS;
    const totalTimeoutMs = options.totalTimeoutMs || DEFAULTS.RESPONSE_TOTAL_TIMEOUT_MS;

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

      if (context.notified) {
        return snapshot();
      }

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
