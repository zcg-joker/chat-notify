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
  const LOG_PREFIX = "[Chat Notify]";
  const NOTIFICATION_ICON_PATH = "assets/icon-128.png";
  const POPUP_STATUS_KEY = "popupStatus";
  const NOTIFICATION_TARGETS_KEY = "notificationTargets";
  const PAGE_PROBE_CONTENT_FILES = Object.freeze([
    "src/shared/constants.js",
    "src/shared/messages.js",
    "src/core/prompt-excerpt.js",
    "src/core/state-machine.js",
    "src/core/session-tracker.js",
    "src/core/dom-watch.js",
    "src/adapters/adapter-contract.js",
    "src/adapters/chatgpt-adapter.js",
    "src/adapters/gemini-adapter.js",
    "src/content/page-probe-adapter.js",
    "src/core/monitor-controller.js",
  ]);
  const DEFAULT_POPUP_STATUS = Object.freeze({
    notificationHealth: Object.freeze({ state: "not_tested", message: "", updatedAt: null }),
    lastCompletion: Object.freeze({ state: "none", siteId: "", updatedAt: null }),
    diagnostics: Object.freeze({ latestFlow: null, probeSamples: Object.freeze([]) }),
  });
  const MAX_DIAGNOSTIC_EVENTS = 8;
  const MAX_REQUEST_CANDIDATES = 20;
  const MAX_PROBE_SAMPLES = 5;

  function log(level, message, detail) {
    if (typeof console === "undefined" || typeof console[level] !== "function") {
      return;
    }
    if (detail === undefined) {
      console[level](LOG_PREFIX, message);
      return;
    }
    console[level](LOG_PREFIX, message, detail);
  }

  function sanitizeNotificationIdPart(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
  }

  function resolveNotificationIcon(chromeApi) {
    if (chromeApi && chromeApi.runtime && typeof chromeApi.runtime.getURL === "function") {
      return chromeApi.runtime.getURL(NOTIFICATION_ICON_PATH);
    }
    return NOTIFICATION_ICON_PATH;
  }

  function buildCompletionNotification(payload, chromeApi) {
    const displayName = payload.displayName || "AI";
    const promptExcerpt = payload.promptExcerpt || "";
    return {
      type: "basic",
      iconUrl: resolveNotificationIcon(chromeApi),
      title: `${displayName} response complete`,
      message: promptExcerpt ? `"${promptExcerpt}" is ready` : "Your response is ready",
      priority: 1,
    };
  }

  function sanitizePromptExcerpt(value, limit = 40) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 40;
    const characters = Array.from(normalized);
    if (characters.length === 0) {
      return "";
    }
    if (characters.length <= safeLimit) {
      return normalized;
    }
    return `${characters.slice(0, safeLimit).join("")}...`;
  }

  function sanitizeDiagnosticRequest(request) {
    if (!request || typeof request !== "object") {
      return null;
    }
    const result = {
      requestKind: request.requestKind || "",
      method: request.method || "",
      host: request.host || "",
      path: request.path || "",
      matched: Boolean(request.matched),
      reason: request.reason || "",
    };
    if (!result.requestKind && !result.method && !result.host && !result.path && !result.reason) {
      return null;
    }
    return result;
  }

  function requestCandidateKey(request) {
    return [
      request.requestKind,
      request.method,
      request.host,
      request.path,
      request.matched ? "matched" : "ignored",
      request.reason,
    ].join("\u0000");
  }

  function appendRequestCandidate(existingCandidates, request) {
    const sanitized = sanitizeDiagnosticRequest(request);
    if (!sanitized || !sanitized.matched) {
      return Array.isArray(existingCandidates) ? existingCandidates.slice(-MAX_REQUEST_CANDIDATES) : [];
    }
    const candidates = Array.isArray(existingCandidates) ? existingCandidates.slice() : [];
    const key = requestCandidateKey(sanitized);
    const withoutDuplicate = candidates.filter((candidate) => requestCandidateKey(candidate) !== key);
    withoutDuplicate.push(sanitized);
    return withoutDuplicate.slice(-MAX_REQUEST_CANDIDATES);
  }

  function cloneRequestCandidates(candidates) {
    return Array.isArray(candidates)
      ? candidates
          .map(sanitizeDiagnosticRequest)
          .filter(Boolean)
          .slice(-MAX_REQUEST_CANDIDATES)
      : [];
  }

  function cloneProbeSamples(samples) {
    return Array.isArray(samples)
      ? samples
          .map((sample) => ({
            flowId: sample && sample.flowId ? sample.flowId : "",
            siteId: sample && sample.siteId ? sample.siteId : "",
            displayName: sample && sample.displayName ? sample.displayName : "",
            updatedAt: sample && Number.isFinite(sample.updatedAt) ? sample.updatedAt : null,
            requestCandidates: cloneRequestCandidates(sample && sample.requestCandidates),
          }))
          .filter((sample) => sample.flowId)
          .slice(-MAX_PROBE_SAMPLES)
      : [];
  }

  function updateProbeSamples(existingSamples, flow) {
    const samples = cloneProbeSamples(existingSamples);
    if (!flow || flow.siteId !== "page-probe" || !flow.flowId) {
      return samples;
    }
    const requestCandidates = cloneRequestCandidates(flow.requestCandidates);
    if (!requestCandidates.length) {
      return samples;
    }
    const nextSample = {
      flowId: flow.flowId,
      siteId: flow.siteId,
      displayName: flow.displayName || "",
      updatedAt: Number.isFinite(flow.updatedAt) ? flow.updatedAt : null,
      requestCandidates,
    };
    return samples
      .filter((sample) => sample.flowId !== nextSample.flowId)
      .concat(nextSample)
      .slice(-MAX_PROBE_SAMPLES);
  }

  function createNotificationService(options = {}) {
    const chromeApi = options.chromeApi || globalThis.chrome;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    let memoryNotificationTargets = {};
    let memoryPopupStatus = clonePopupStatus(DEFAULT_POPUP_STATUS);
    let notificationTargetsMemoryAuthoritative = false;
    let popupStatusMemoryAuthoritative = false;
    let notificationCounter = 0;
    let popupStatusMutation = Promise.resolve();
    let notificationTargetMutation = Promise.resolve();

    function isFiniteNumber(value) {
      return Number.isFinite(value);
    }

    function clonePopupStatus(status) {
      const source = status || DEFAULT_POPUP_STATUS;
      return {
        notificationHealth: Object.assign(
          {},
          DEFAULT_POPUP_STATUS.notificationHealth,
          source.notificationHealth || {}
        ),
        lastCompletion: Object.assign(
          {},
          DEFAULT_POPUP_STATUS.lastCompletion,
          source.lastCompletion || {}
        ),
        diagnostics: {
          latestFlow: source.diagnostics && source.diagnostics.latestFlow
            ? {
                flowId: source.diagnostics.latestFlow.flowId || "",
                siteId: source.diagnostics.latestFlow.siteId || "",
                displayName: source.diagnostics.latestFlow.displayName || "",
                promptExcerpt: sanitizePromptExcerpt(source.diagnostics.latestFlow.promptExcerpt),
                updatedAt: isFiniteNumber(source.diagnostics.latestFlow.updatedAt)
                  ? source.diagnostics.latestFlow.updatedAt
                  : null,
                events: Array.isArray(source.diagnostics.latestFlow.events)
                  ? source.diagnostics.latestFlow.events.slice(-MAX_DIAGNOSTIC_EVENTS).map((event) => {
                      const clonedEvent = {
                        eventType: event.eventType || "",
                        status: event.status === "failed" ? "failed" : "ok",
                        message: event.message || "",
                        updatedAt: isFiniteNumber(event.updatedAt) ? event.updatedAt : null,
                      };
                      const request = sanitizeDiagnosticRequest(event.request);
                      if (request) {
                        clonedEvent.request = request;
                      }
                      return clonedEvent;
                    })
                  : [],
                requestCandidates: Array.isArray(source.diagnostics.latestFlow.requestCandidates)
                  ? cloneRequestCandidates(source.diagnostics.latestFlow.requestCandidates)
                  : [],
              }
            : null,
          probeSamples: cloneProbeSamples(source.diagnostics && source.diagnostics.probeSamples),
        },
      };
    }

    function getStorageArea(name) {
      return chromeApi && chromeApi.storage && chromeApi.storage[name];
    }

    function getRuntimeLastError() {
      const lastError = chromeApi.runtime && chromeApi.runtime.lastError;
      if (lastError && chromeApi.runtime) {
        try {
          delete chromeApi.runtime.lastError;
        } catch (_error) {
          chromeApi.runtime.lastError = undefined;
        }
      }
      return lastError;
    }

    function storageGet(area, defaults, fallback) {
      const fallbackValues = fallback || defaults || {};
      return new Promise((resolve) => {
        if (!area || typeof area.get !== "function") {
          resolve(Object.assign({}, fallbackValues));
          return;
        }
        try {
          area.get(defaults || {}, (values) => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve(Object.assign({}, fallbackValues));
              return;
            }
            resolve(Object.assign({}, defaults || {}, values || {}));
          });
        } catch (_error) {
          resolve(Object.assign({}, fallbackValues));
        }
      });
    }

    function storageSet(area, values) {
      return new Promise((resolve) => {
        if (!area || typeof area.set !== "function") {
          resolve({ ok: false });
          return;
        }
        try {
          area.set(values, () => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
      });
    }

    function updateWindow(windowId, optionsForWindow) {
      return new Promise((resolve) => {
        if (!chromeApi.windows || typeof chromeApi.windows.update !== "function") {
          resolve({ ok: false, error: "windows.update unavailable" });
          return;
        }
        try {
          chromeApi.windows.update(windowId, optionsForWindow, () => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
      });
    }

    function updateTab(tabId, optionsForTab) {
      return new Promise((resolve) => {
        if (!chromeApi.tabs || typeof chromeApi.tabs.update !== "function") {
          resolve({ ok: false, error: "tabs.update unavailable" });
          return;
        }
        try {
          chromeApi.tabs.update(tabId, optionsForTab, () => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
      });
    }

    function executeScript(details) {
      return new Promise((resolve) => {
        if (!chromeApi.scripting || typeof chromeApi.scripting.executeScript !== "function") {
          resolve({ ok: false, error: "scripting.executeScript unavailable" });
          return;
        }
        try {
          chromeApi.scripting.executeScript(details, () => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
      });
    }

    function getSenderTabHost(sender) {
      try {
        return sender && sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname.toLowerCase() : "";
      } catch (_error) {
        return "";
      }
    }

    async function startPageProbe(payload = {}, sender = {}) {
      const tabId = Number.isFinite(payload.tabId) ? payload.tabId : sender.tab && sender.tab.id;
      const host = typeof payload.host === "string" ? payload.host.trim().toLowerCase() : "";
      if (!isFiniteNumber(tabId) || !host) {
        return { ok: false, error: "Probe requires an active tab and host" };
      }
      if (sender.tab && sender.tab.id !== tabId) {
        return { ok: false, error: "Probe tab does not match active tab" };
      }
      if (getSenderTabHost(sender) !== host) {
        return { ok: false, error: "Probe host does not match active tab" };
      }

      const injections = [
        { target: { tabId }, files: PAGE_PROBE_CONTENT_FILES },
        { target: { tabId }, files: ["src/content/page-lifecycle-bridge.js"], world: "MAIN" },
        { target: { tabId }, files: ["src/content/content-script.js"] },
      ];
      for (const injection of injections) {
        const result = await executeScript(injection);
        if (!result.ok) {
          return { ok: false, error: result.error || "Unable to inject page probe" };
        }
      }

      await recordDiagnosticEvent({
        flowId: `probe:${host}:${now()}`,
        siteId: "page-probe",
        displayName: "Page Probe",
        eventType: "probe_started",
        message: host,
      });
      return { ok: true, probeStarted: true, host };
    }

    async function getPopupStatus() {
      const local = getStorageArea("local");
      if (!local || popupStatusMemoryAuthoritative) {
        return clonePopupStatus(memoryPopupStatus);
      }
      const values = await storageGet(
        local,
        { [POPUP_STATUS_KEY]: clonePopupStatus(DEFAULT_POPUP_STATUS) },
        { [POPUP_STATUS_KEY]: clonePopupStatus(memoryPopupStatus) }
      );
      return clonePopupStatus(values[POPUP_STATUS_KEY]);
    }

    async function setPopupStatus(nextStatus) {
      const sanitized = clonePopupStatus(nextStatus);
      memoryPopupStatus = clonePopupStatus(sanitized);
      const writeResult = await storageSet(getStorageArea("local"), { [POPUP_STATUS_KEY]: sanitized });
      popupStatusMemoryAuthoritative = !writeResult.ok;
      return sanitized;
    }

    function mutatePopupStatus(mutator) {
      const mutation = popupStatusMutation.then(async () => {
        const current = await getPopupStatus();
        const nextStatus = mutator(current) || current;
        return setPopupStatus(nextStatus);
      });
      popupStatusMutation = mutation.catch(() => {});
      return mutation;
    }

    async function patchPopupStatus(patch) {
      return mutatePopupStatus((current) => ({
        notificationHealth: Object.assign({}, current.notificationHealth, patch.notificationHealth || {}),
        lastCompletion: Object.assign({}, current.lastCompletion, patch.lastCompletion || {}),
        diagnostics: patch.diagnostics || current.diagnostics,
      }));
    }

    async function recordDiagnosticEvent(input = {}) {
      return mutatePopupStatus((current) => {
        const payload = messages.createDiagnosticEventMessage
          ? messages.createDiagnosticEventMessage(input).payload
          : input;
        const currentFlow = current.diagnostics && current.diagnostics.latestFlow;
        const event = {
          eventType: payload.eventType || "",
          status: payload.status === "failed" ? "failed" : "ok",
          message: payload.message || "",
          updatedAt: now(),
        };
        const request = sanitizeDiagnosticRequest(payload.request);
        if (request) {
          event.request = request;
        }
        const sameFlow = currentFlow && currentFlow.flowId === (payload.flowId || "");
        const previousEvents = sameFlow && Array.isArray(currentFlow.events) ? currentFlow.events : [];
        const previousRequestCandidates =
          sameFlow && Array.isArray(currentFlow.requestCandidates) ? currentFlow.requestCandidates : [];
        const latestFlow = {
          flowId: payload.flowId || "",
          siteId: payload.siteId || "",
          displayName: payload.displayName || "",
          promptExcerpt: sanitizePromptExcerpt(payload.promptExcerpt),
          updatedAt: event.updatedAt,
          events: previousEvents.concat(event).slice(-MAX_DIAGNOSTIC_EVENTS),
          requestCandidates: appendRequestCandidate(previousRequestCandidates, request),
        };
        const probeSamples = updateProbeSamples(
          current.diagnostics && current.diagnostics.probeSamples,
          latestFlow
        );
        return {
          notificationHealth: current.notificationHealth,
          lastCompletion: current.lastCompletion,
          diagnostics: { latestFlow, probeSamples },
        };
      });
    }

    async function getNotificationTargets() {
      const session = getStorageArea("session");
      if (!session || notificationTargetsMemoryAuthoritative) {
        return Object.assign({}, memoryNotificationTargets);
      }
      const values = await storageGet(
        session,
        { [NOTIFICATION_TARGETS_KEY]: {} },
        { [NOTIFICATION_TARGETS_KEY]: Object.assign({}, memoryNotificationTargets) }
      );
      return Object.assign({}, values[NOTIFICATION_TARGETS_KEY] || {});
    }

    async function setNotificationTargets(targets) {
      const sanitizedTargets = Object.keys(targets || {}).reduce((result, notificationId) => {
        const target = targets[notificationId] || {};
        if (!target.notificationId || !isFiniteNumber(target.tabId)) {
          return result;
        }
        result[notificationId] = {
          notificationId: String(target.notificationId),
          tabId: target.tabId,
          createdAt: isFiniteNumber(target.createdAt) ? target.createdAt : now(),
          flowId: typeof target.flowId === "string" ? target.flowId : "",
          siteId: typeof target.siteId === "string" ? target.siteId : "",
          displayName: typeof target.displayName === "string" ? target.displayName : "",
          promptExcerpt: sanitizePromptExcerpt(target.promptExcerpt),
        };
        if (isFiniteNumber(target.windowId)) {
          result[notificationId].windowId = target.windowId;
        }
        return result;
      }, {});
      memoryNotificationTargets = Object.assign({}, sanitizedTargets);
      const writeResult = await storageSet(getStorageArea("session"), { [NOTIFICATION_TARGETS_KEY]: sanitizedTargets });
      notificationTargetsMemoryAuthoritative = !writeResult.ok;
      return sanitizedTargets;
    }

    function mutateNotificationTargets(mutator) {
      const mutation = notificationTargetMutation.then(async () => {
        const targets = await getNotificationTargets();
        const nextTargets = mutator(targets) || targets;
        return setNotificationTargets(nextTargets);
      });
      notificationTargetMutation = mutation.catch(() => {});
      return mutation;
    }

    async function storeNotificationTarget(notificationId, sourceTabId, sender, payload = {}) {
      if (!isFiniteNumber(sourceTabId)) {
        return;
      }
      const target = {
        notificationId,
        tabId: sourceTabId,
        createdAt: now(),
        flowId: typeof payload.flowId === "string" ? payload.flowId : "",
        siteId: typeof payload.siteId === "string" ? payload.siteId : "",
        displayName: typeof payload.displayName === "string" ? payload.displayName : "",
        promptExcerpt: sanitizePromptExcerpt(payload.promptExcerpt),
      };
      if (
        sender &&
        sender.tab &&
        sender.tab.id === sourceTabId &&
        isFiniteNumber(sender.tab.windowId)
      ) {
        target.windowId = sender.tab.windowId;
      }
      await mutateNotificationTargets((targets) => {
        targets[notificationId] = target;
        return targets;
      });
    }

    async function clearNotificationTarget(notificationId) {
      let cleared = false;
      await mutateNotificationTargets((targets) => {
        if (!Object.prototype.hasOwnProperty.call(targets, notificationId)) {
          return targets;
        }
        cleared = true;
        delete targets[notificationId];
        return targets;
      });
      return cleared;
    }

    function notify(id, optionsForNotification) {
      return new Promise((resolve) => {
        try {
          chromeApi.notifications.create(id, optionsForNotification, (createdId) => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve({ ok: false, error: lastError.message || String(lastError) });
              return;
            }
            resolve({ ok: true, createdId });
          });
        } catch (error) {
          resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
      });
    }

    function getEnabled() {
      return new Promise((resolve) => {
        if (!chromeApi.storage || !chromeApi.storage.sync || typeof chromeApi.storage.sync.get !== "function") {
          resolve(true);
          return;
        }

        try {
          chromeApi.storage.sync.get({ enabled: true }, (settings) => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve(true);
              return;
            }
            resolve(Boolean(settings.enabled));
          });
        } catch (_error) {
          resolve(true);
        }
      });
    }

    function getDebugLogs() {
      return new Promise((resolve) => {
        if (!chromeApi.storage || !chromeApi.storage.sync || typeof chromeApi.storage.sync.get !== "function") {
          resolve(false);
          return;
        }

        try {
          chromeApi.storage.sync.get({ debugLogs: false }, (settings) => {
            const lastError = getRuntimeLastError();
            if (lastError) {
              resolve(false);
              return;
            }
            resolve(Boolean(settings.debugLogs));
          });
        } catch (_error) {
          resolve(false);
        }
      });
    }

    async function handleMessage(message, sender = {}) {
      const debugLogs = await getDebugLogs();
      const writeLog = (level, logMessage, detail) => {
        if (debugLogs) {
          log(level, logMessage, detail);
        }
      };

      writeLog("debug", "background message received", { type: message && message.type, senderTabId: sender.tab && sender.tab.id });
      if (message && message.type === MESSAGE_TYPES.GET_POPUP_STATUS) {
        return { ok: true, popupStatus: await getPopupStatus() };
      }

      if (message && message.type === MESSAGE_TYPES.START_PAGE_PROBE) {
        return startPageProbe(message.payload || {}, sender);
      }

      if (message && message.type === MESSAGE_TYPES.DIAGNOSTIC_EVENT) {
        await recordDiagnosticEvent(message.payload || {});
        return { ok: true };
      }

      if (message && message.type === MESSAGE_TYPES.TEST_NOTIFICATION) {
        const id = `chat-notify:test:${now()}`;
        const notificationResult = await notify(id, {
          type: "basic",
          iconUrl: resolveNotificationIcon(chromeApi),
          title: "Chat Notify test",
          message: "Notifications are working",
          priority: 1,
        });
        if (!notificationResult.ok) {
          await patchPopupStatus({
            notificationHealth: {
              state: "failed",
              message: notificationResult.error || "",
              updatedAt: now(),
            },
          });
          writeLog("warn", "test notification failed", notificationResult.error);
          return { ok: false, error: notificationResult.error, notificationId: id };
        }
        await patchPopupStatus({
          notificationHealth: {
            state: "ok",
            message: "",
            updatedAt: now(),
          },
        });
        writeLog("info", "test notification created", id);
        return { ok: true, notificationId: id };
      }

      if (!message || message.type !== MESSAGE_TYPES.AI_RESPONSE_COMPLETED) {
        writeLog("debug", "background message ignored");
        return { ok: false, ignored: true };
      }

      if (!(await getEnabled())) {
        writeLog("info", "completion notification ignored because extension is disabled");
        return { ok: false, ignored: true, disabled: true };
      }

      const payload = message.payload || {};
      const sourceTabId =
        Number.isFinite(payload.sourceTabId) ? payload.sourceTabId : sender.tab && sender.tab.id;
      notificationCounter += 1;
      const id = [
        "chat-notify",
        sanitizeNotificationIdPart(payload.siteId),
        sanitizeNotificationIdPart(sourceTabId),
        now(),
        notificationCounter,
      ].join(":");

      if (isFiniteNumber(sourceTabId)) {
        await storeNotificationTarget(id, sourceTabId, sender, payload);
      }
      const notificationResult = await notify(id, buildCompletionNotification(payload, chromeApi));
      if (!notificationResult.ok) {
        await clearNotificationTarget(id);
        await recordDiagnosticEvent({
          flowId: payload.flowId || "",
          siteId: payload.siteId || "",
          displayName: payload.displayName || "",
          promptExcerpt: payload.promptExcerpt || "",
          eventType: "notification_failed",
          status: "failed",
          message: notificationResult.error || "",
        });
        await patchPopupStatus({
          lastCompletion: {
            state: "failed",
            siteId: payload.siteId || "",
            updatedAt: now(),
          },
        });
        writeLog("warn", "completion notification failed", notificationResult.error);
        return { ok: false, error: notificationResult.error, notificationId: id };
      }
      await recordDiagnosticEvent({
        flowId: payload.flowId || "",
        siteId: payload.siteId || "",
        displayName: payload.displayName || "",
        promptExcerpt: payload.promptExcerpt || "",
        eventType: "notification_sent",
      });
      await patchPopupStatus({
        lastCompletion: {
          state: "sent",
          siteId: payload.siteId || "",
          updatedAt: now(),
        },
      });
      writeLog("info", "completion notification created", {
        notificationId: id,
        siteId: payload.siteId,
      });
      return { ok: true, notificationId: id };
    }

    async function handleNotificationClicked(notificationId) {
      const targets = await getNotificationTargets();
      const target = targets[notificationId];
      if (!target || !isFiniteNumber(target.tabId)) {
        return { ok: false, ignored: true };
      }

      const focusResult = isFiniteNumber(target.windowId)
        ? await updateWindow(target.windowId, { focused: true })
        : { ok: true };
      const tabResult = await updateTab(target.tabId, { active: true });
      await clearNotificationTarget(notificationId);

      if (focusResult.ok && tabResult.ok) {
        await recordDiagnosticEvent({
          flowId: target.flowId || "",
          siteId: target.siteId || "",
          displayName: target.displayName || "",
          promptExcerpt: target.promptExcerpt || "",
          eventType: "notification_focus_succeeded",
        });
        return { ok: true, focused: true };
      }
      await recordDiagnosticEvent({
        flowId: target.flowId || "",
        siteId: target.siteId || "",
        displayName: target.displayName || "",
        promptExcerpt: target.promptExcerpt || "",
        eventType: "notification_focus_failed",
        status: "failed",
        message: focusResult.error || tabResult.error || "Unable to focus notification target",
      });
      return {
        ok: false,
        focused: false,
        cleared: true,
        error: focusResult.error || tabResult.error || "Unable to focus notification target",
      };
    }

    return {
      handleMessage,
      handleNotificationClicked,
      buildCompletionNotification,
      resolveNotificationIcon: () => resolveNotificationIcon(chromeApi),
    };
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    const service = createNotificationService({ chromeApi: chrome });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      service
        .handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error),
          });
        });
      return true;
    });
    if (
      chrome.notifications &&
      chrome.notifications.onClicked &&
      typeof chrome.notifications.onClicked.addListener === "function"
    ) {
      chrome.notifications.onClicked.addListener((notificationId) => {
        service.handleNotificationClicked(notificationId).catch((error) => {
          log("warn", "notification click handling failed", error && error.message ? error.message : String(error));
        });
      });
    }
  }

  return {
    createNotificationService,
    buildCompletionNotification,
    resolveNotificationIcon,
    DEFAULT_POPUP_STATUS,
  };
});
