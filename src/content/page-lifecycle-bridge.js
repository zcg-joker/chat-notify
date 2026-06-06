(function installChatNotifyLifecycleBridge() {
  if (window.__chatNotifyLifecycleBridgeInstalled) {
    return;
  }
  window.__chatNotifyLifecycleBridgeInstalled = true;

  const originalFetch = window.fetch;
  let sequence = 0;
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const GENERATION_URL_PATHS = new Set([
    "/backend-api/conversation",
    "/backend-api/f/conversation",
    "/conversation",
  ]);

  function getNormalizedUrl(input) {
    const url = typeof input === "string" ? input : input && input.url;
    if (typeof url !== "string") {
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
    return {
      url: normalizedUrl,
      method: String(method || "GET").toUpperCase(),
    };
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

    try {
      const response = await originalFetch.apply(this, arguments);

      if (!response.ok) {
        postTerminalEvent("failed");
        return response;
      }

      if (!response.body || typeof ReadableStream === "undefined" || typeof response.clone !== "function") {
        postTerminalEvent("completed");
        return response;
      }

      try {
        const clone = response.clone();
        const reader = clone.body && typeof clone.body.getReader === "function"
          ? clone.body.getReader()
          : null;

        if (!reader) {
          postTerminalEvent("completed");
          return response;
        }

        (async () => {
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) {
                postTerminalEvent("completed");
                return;
              }
            }
          } catch (error) {
            postTerminalEvent(error && error.name === "AbortError" ? "canceled" : "failed");
          }
        })();
      } catch (_error) {
        postTerminalEvent("completed");
      }

      return response;
    } catch (error) {
      const phase = error && error.name === "AbortError" ? "canceled" : "failed";
      postTerminalEvent(phase);
      throw error;
    }
  };
})();
