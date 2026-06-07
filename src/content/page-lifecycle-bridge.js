(function installChatNotifyLifecycleBridge() {
  const LOG_PREFIX = "[Chat Notify]";
  let debugLogs = false;

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

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data || {};
    if (data.source !== "chat-notify-content-script" || data.type !== "CHAT_NOTIFY_DEBUG_LOGS_CHANGED") {
      return;
    }

    debugLogs = Boolean(data.debugLogs);
    log("info", "page lifecycle bridge debug state changed", { debugLogs });
  });

  const originalFetch = window.fetch;
  let sequence = 0;
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const GENERATION_URL_PATHS = new Set([
    "/backend-api/conversation",
    "/backend-api/f/conversation",
    "/conversation",
  ]);
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

  function getNormalizedUrl(input) {
    const url = getInputUrl(input);
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url, window.location.href);
      if (!CHATGPT_HOSTS.has(parsed.hostname) || !GENERATION_URL_PATHS.has(parsed.pathname)) {
        return "";
      }
      return `${parsed.origin}${parsed.pathname}`;
    } catch (_error) {
      return "";
    }
  }

  function getRequestMeta(input, init, normalizedUrl) {
    const method =
      (init && init.method) ||
      (input && input.method) ||
      "GET";
    const meta = {
      url: normalizedUrl,
      method: String(method || "GET").toUpperCase(),
    };
    const promptExcerpt = extractPromptExcerpt(input, init);
    if (promptExcerpt) {
      meta.promptExcerpt = promptExcerpt;
    }
    return meta;
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

  function extractPromptExcerpt(input, init) {
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

  function postLifecycleEvent(detail) {
    window.postMessage(
      {
        source: "chat-notify-page-lifecycle-bridge",
        detail,
      },
      window.location.origin
    );
  }

  window.fetch = async function chatNotifyFetch(input, init) {
    const normalizedUrl = getNormalizedUrl(input);
    if (!normalizedUrl) {
      const rawUrl = getInputUrl(input);
      if (rawUrl && String(rawUrl).includes("conversation")) {
        log("debug", "fetch ignored by lifecycle bridge", { url: String(rawUrl) });
      }
      return originalFetch.apply(this, arguments);
    }

    const lifecycleId = `fetch:${Date.now()}:${++sequence}`;
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

    try {
      const response = await originalFetch.apply(this, arguments);

      if (!response.ok) {
        log("warn", "lifecycle failed: non-ok response", { lifecycleId, status: response.status });
        postTerminalEvent("failed");
        return response;
      }

      if (!response.body || typeof ReadableStream === "undefined") {
        log("info", "lifecycle completed: response has no stream", { lifecycleId });
        postTerminalEvent("completed");
        return response;
      }

      if (typeof response.clone !== "function") {
        log("warn", "lifecycle failed: response clone unavailable", { lifecycleId });
        postTerminalEvent("failed");
        return response;
      }

      try {
        const clone = response.clone();
        const reader = clone.body && typeof clone.body.getReader === "function"
          ? clone.body.getReader()
          : null;

        if (!reader) {
          log("warn", "lifecycle failed: clone reader unavailable", { lifecycleId });
          postTerminalEvent("failed");
          return response;
        }

        (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) {
                log("info", "lifecycle completed: stream drained", { lifecycleId });
                postTerminalEvent("completed");
                return;
              }
            }
          } catch (error) {
            log("warn", "lifecycle terminal read error", {
              lifecycleId,
              errorName: error && error.name,
            });
            postTerminalEvent(error && error.name === "AbortError" ? "canceled" : "failed");
          }
        })();
      } catch (_error) {
        log("warn", "lifecycle failed: clone setup error", { lifecycleId });
        postTerminalEvent("failed");
      }

      return response;
    } catch (error) {
      const phase = error && error.name === "AbortError" ? "canceled" : "failed";
      log("warn", "lifecycle terminal fetch error", { lifecycleId, phase, errorName: error && error.name });
      postTerminalEvent(phase);
      throw error;
    }
  };
})();
