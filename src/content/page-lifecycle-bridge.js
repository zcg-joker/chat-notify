(function installChatNotifyLifecycleBridge() {
  const LOG_PREFIX = "[Chat Notify]";
  let debugLogs = false;
  let bridgeConfig = null;

  function log(level, message, detail) {
    if (!debugLogs || typeof console === "undefined" || typeof console[level] !== "function") {
      return;
    }
    if (detail === undefined) {
      console[level](LOG_PREFIX, message);
      return;
    }
    console[level](LOG_PREFIX, message, detail);
  }

  if (window.__chatNotifyLifecycleBridgeInstalled) {
    log("debug", "page lifecycle bridge already installed");
    return;
  }
  window.__chatNotifyLifecycleBridgeInstalled = true;
  log("info", "page lifecycle bridge installed");

  function sanitizeBridgeConfig(config) {
    if (!config || typeof config !== "object" || typeof config.siteId !== "string") {
      return null;
    }
    if (
      config.promptExtractor !== "chatgpt" &&
      config.promptExtractor !== "gemini" &&
      config.promptExtractor !== "none"
    ) {
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
      promptExtractor: config.promptExtractor,
      probeOnly: Boolean(config.probeOnly),
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data || {};
    if (data.source === "chat-notify-content-script" && data.type === "CHAT_NOTIFY_LIFECYCLE_BRIDGE_CONFIG") {
      const nextConfig = sanitizeBridgeConfig(data.config);
      if (nextConfig) {
        bridgeConfig = nextConfig;
        log("info", "page lifecycle bridge config changed", { siteId: bridgeConfig.siteId });
      }
      return;
    }

    if (data.source !== "chat-notify-content-script" || data.type !== "CHAT_NOTIFY_DEBUG_LOGS_CHANGED") {
      return;
    }
    debugLogs = Boolean(data.debugLogs);
    log("info", "page lifecycle bridge debug state changed", { debugLogs });
  });

  const originalFetch = window.fetch;
  let sequence = 0;
  const PROMPT_EXCERPT_LIMIT = 40;

  function createPromptExcerpt(value) {
    if (typeof value !== "string") {
      return "";
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    const characters = Array.from(normalized);
    if (characters.length <= PROMPT_EXCERPT_LIMIT) {
      return normalized;
    }
    return `${characters.slice(0, PROMPT_EXCERPT_LIMIT).join("")}...`;
  }

  function getInputUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function matcherMatchesPath(matcher, pathname) {
    if (matcher.pathname && pathname === matcher.pathname) {
      return true;
    }
    if (matcher.pathnameIncludes && pathname.includes(matcher.pathnameIncludes)) {
      return true;
    }
    return false;
  }

  function inspectRequest(input) {
    if (!bridgeConfig) {
      return null;
    }
    const url = getInputUrl(input);
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url, window.location.href);
      if (!bridgeConfig.hosts.includes(parsed.hostname)) {
        return {
          host: parsed.hostname,
          path: parsed.pathname,
          matched: false,
          reason: "host_not_matched",
          normalizedUrl: "",
        };
      }
      if (!bridgeConfig.generationRequestMatchers.some((matcher) => matcherMatchesPath(matcher, parsed.pathname))) {
        return {
          host: parsed.hostname,
          path: parsed.pathname,
          matched: false,
          reason: "path_not_matched",
          normalizedUrl: "",
        };
      }
      return {
        host: parsed.hostname,
        path: parsed.pathname,
        matched: true,
        reason: bridgeConfig.probeOnly ? "probe_observed_request" : "matched_generation_request",
        normalizedUrl: `${parsed.origin}${parsed.pathname}`,
      };
    } catch (_error) {
      return null;
    }
  }

  function getNormalizedUrl(input) {
    const inspected = inspectRequest(input);
    return inspected && inspected.matched ? inspected.normalizedUrl : "";
  }

  function getRequestMethod(input, init) {
    return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  }

  function getRequestMeta(input, init, normalizedUrl) {
    const method =
      (init && init.method) ||
      (input && input.method) ||
      "GET";
    const meta = {
      siteId: bridgeConfig.siteId,
      url: normalizedUrl,
      method: String(method || "GET").toUpperCase(),
    };
    const promptExcerpt = extractPromptExcerpt(input, init);
    if (promptExcerpt) {
      meta.promptExcerpt = promptExcerpt;
    }
    return meta;
  }

  function postRequestProbe(requestKind, input, init, inspected) {
    if (!debugLogs || !bridgeConfig || !inspected || !bridgeConfig.hosts.includes(inspected.host)) {
      return;
    }
    postLifecycleEvent({
      eventType: "request_probe",
      siteId: bridgeConfig.siteId,
      requestKind,
      method: getRequestMethod(input, init),
      host: inspected.host,
      path: inspected.path,
      matched: inspected.matched,
      reason: inspected.reason,
    });
  }

  function getRequestBody(input, init) {
    if (init && typeof init.body === "string") {
      return init.body;
    }
    if (input && typeof input.body === "string") {
      return input.body;
    }
    return "";
  }

  function getContentText(content) {
    if (!content || typeof content !== "object") {
      return "";
    }
    if (Array.isArray(content.parts)) {
      return content.parts.filter((part) => typeof part === "string").join("\n");
    }
    if (typeof content.text === "string") {
      return content.text;
    }
    return "";
  }

  function extractChatGptPromptExcerpt(input, init) {
    const body = getRequestBody(input, init);
    if (!body || body.length > 200000) {
      return "";
    }

    try {
      const payload = JSON.parse(body);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || !message.author || message.author.role !== "user") {
          continue;
        }
        const excerpt = createPromptExcerpt(getContentText(message.content));
        if (excerpt) {
          return excerpt;
        }
      }
    } catch (_error) {
      return "";
    }
    return "";
  }

  function collectStrings(value, result) {
    if (typeof value === "string") {
      result.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectStrings(entry, result));
    }
  }

  function isLikelyGeminiMetadata(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }
    if (/^https?:\/\//i.test(trimmed) || /^\d+$/.test(trimmed)) {
      return true;
    }
    if (/^(StreamGenerate|POST|GET|BardFrontendService)$/i.test(trimmed) || /^wrb\./i.test(trimmed)) {
      return true;
    }
    return trimmed.includes("BardChatUi");
  }

  function extractGeminiPromptExcerpt(input, init) {
    const body = getRequestBody(input, init);
    if (!body || body.length > 200000) {
      return "";
    }
    const candidates = [body];
    try {
      const params = new URLSearchParams(body);
      const formRequest = params.get("f.req");
      if (formRequest) {
        candidates.unshift(formRequest);
      }
    } catch (_error) {
      // Ignore bodies that are not form-encoded.
    }

    for (const candidateBody of candidates) {
      const excerpt = extractGeminiPromptExcerptFromJson(candidateBody);
      if (excerpt) {
        return excerpt;
      }
    }
    return "";
  }

  function extractGeminiPromptExcerptFromJson(body) {
    try {
      const parsed = JSON.parse(body);
      const strings = [];
      collectStrings(parsed, strings);
      const candidate = strings.find((value) => !isLikelyGeminiMetadata(value));
      return createPromptExcerpt(candidate || "");
    } catch (_error) {
      return "";
    }
  }

  function extractPromptExcerpt(input, init) {
    if (!bridgeConfig) {
      return "";
    }
    if (bridgeConfig.promptExtractor === "none") {
      return "";
    }
    if (bridgeConfig.promptExtractor === "gemini") {
      return extractGeminiPromptExcerpt(input, init);
    }
    return extractChatGptPromptExcerpt(input, init);
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

  function createLifecycleTracker(type, input, init, normalizedUrl) {
    const lifecycleId = `${type}:${Date.now()}:${++sequence}`;
    const meta = getRequestMeta(input, init, normalizedUrl);
    let hasTerminalEvent = false;

    function postTerminalEvent(phase) {
      if (hasTerminalEvent) {
        return;
      }
      hasTerminalEvent = true;
      postLifecycleEvent(Object.assign({ lifecycleId, phase }, meta));
    }

    postLifecycleEvent(Object.assign({ lifecycleId, phase: "started" }, meta));
    log("info", "lifecycle started", {
      lifecycleId,
      url: meta.url,
      method: meta.method,
      promptExcerpt: meta.promptExcerpt || "",
    });

    return {
      lifecycleId,
      hasTerminalEvent: () => hasTerminalEvent,
      postTerminalEvent,
    };
  }

  function installXMLHttpRequestObserver() {
    if (typeof window.XMLHttpRequest !== "function") {
      return;
    }

    const prototype = window.XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    if (typeof originalOpen !== "function" || typeof originalSend !== "function") {
      return;
    }

    prototype.open = function chatNotifyXhrOpen(method, url) {
      this.__chatNotifyRequestMethod = method;
      this.__chatNotifyRequestUrl = url;
      return originalOpen.apply(this, arguments);
    };

    prototype.send = function chatNotifyXhrSend(body) {
      const input = {
        url: getInputUrl(this.__chatNotifyRequestUrl) || String(this.__chatNotifyRequestUrl || ""),
        method: this.__chatNotifyRequestMethod,
      };
      const init = {
        method: this.__chatNotifyRequestMethod,
        body,
      };
      const inspected = inspectRequest(input);
      postRequestProbe("xhr", input, init, inspected);
      if (bridgeConfig && bridgeConfig.probeOnly) {
        return originalSend.apply(this, arguments);
      }
      const normalizedUrl = inspected && inspected.matched ? inspected.normalizedUrl : "";
      if (!normalizedUrl) {
        return originalSend.apply(this, arguments);
      }

      const tracker = createLifecycleTracker("xhr", input, init, normalizedUrl);

      const postCompletedOrFailed = () => {
        if (tracker.hasTerminalEvent()) {
          return;
        }
        const status = Number(this.status || 0);
        const phase = status >= 200 && status < 400 ? "completed" : "failed";
        log(phase === "completed" ? "info" : "warn", `lifecycle ${phase}: xhr loadend`, {
          lifecycleId: tracker.lifecycleId,
          status,
        });
        tracker.postTerminalEvent(phase);
      };
      const postCanceled = () => {
        if (tracker.hasTerminalEvent()) {
          return;
        }
        log("warn", "lifecycle canceled: xhr abort", { lifecycleId: tracker.lifecycleId });
        tracker.postTerminalEvent("canceled");
      };
      const postFailed = () => {
        if (tracker.hasTerminalEvent()) {
          return;
        }
        log("warn", "lifecycle failed: xhr error", { lifecycleId: tracker.lifecycleId });
        tracker.postTerminalEvent("failed");
      };

      this.addEventListener("loadend", postCompletedOrFailed);
      this.addEventListener("abort", postCanceled);
      this.addEventListener("error", postFailed);

      try {
        return originalSend.apply(this, arguments);
      } catch (error) {
        log("warn", "lifecycle failed: xhr send error", {
          lifecycleId: tracker.lifecycleId,
          errorName: error && error.name,
        });
        tracker.postTerminalEvent("failed");
        throw error;
      }
    };
  }

  installXMLHttpRequestObserver();

  window.fetch = async function chatNotifyFetch(input, init) {
    const inspected = inspectRequest(input);
    postRequestProbe("fetch", input, init, inspected);
    if (bridgeConfig && bridgeConfig.probeOnly) {
      return originalFetch.apply(this, arguments);
    }
    const normalizedUrl = inspected && inspected.matched ? inspected.normalizedUrl : "";
    if (!normalizedUrl) {
      const rawUrl = getInputUrl(input);
      if (rawUrl && String(rawUrl).includes("conversation")) {
        log("debug", "fetch ignored by lifecycle bridge", { url: String(rawUrl) });
      }
      return originalFetch.apply(this, arguments);
    }

    const tracker = createLifecycleTracker("fetch", input, init, normalizedUrl);

    try {
      const response = await originalFetch.apply(this, arguments);

      if (!response.ok) {
        log("warn", "lifecycle failed: non-ok response", { lifecycleId: tracker.lifecycleId, status: response.status });
        tracker.postTerminalEvent("failed");
        return response;
      }

      if (!response.body || typeof ReadableStream === "undefined") {
        log("info", "lifecycle completed: response has no stream", { lifecycleId: tracker.lifecycleId });
        tracker.postTerminalEvent("completed");
        return response;
      }

      if (typeof response.clone !== "function") {
        log("warn", "lifecycle failed: response clone unavailable", { lifecycleId: tracker.lifecycleId });
        tracker.postTerminalEvent("failed");
        return response;
      }

      try {
        const clone = response.clone();
        const reader = clone.body && typeof clone.body.getReader === "function"
          ? clone.body.getReader()
          : null;

        if (!reader) {
          log("warn", "lifecycle failed: clone reader unavailable", { lifecycleId: tracker.lifecycleId });
          tracker.postTerminalEvent("failed");
          return response;
        }

        (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) {
                log("info", "lifecycle completed: stream drained", { lifecycleId: tracker.lifecycleId });
                tracker.postTerminalEvent("completed");
                return;
              }
            }
          } catch (error) {
            log("warn", "lifecycle terminal read error", {
              lifecycleId: tracker.lifecycleId,
              errorName: error && error.name,
            });
            tracker.postTerminalEvent(error && error.name === "AbortError" ? "canceled" : "failed");
          }
        })();
      } catch (_error) {
        log("warn", "lifecycle failed: clone setup error", { lifecycleId: tracker.lifecycleId });
        tracker.postTerminalEvent("failed");
      }

      return response;
    } catch (error) {
      const phase = error && error.name === "AbortError" ? "canceled" : "failed";
      log("warn", "lifecycle terminal fetch error", {
        lifecycleId: tracker.lifecycleId,
        phase,
        errorName: error && error.name,
      });
      tracker.postTerminalEvent(phase);
      throw error;
    }
  };
})();
