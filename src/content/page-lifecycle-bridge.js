(function installChatNotifyLifecycleBridge() {
  if (window.__chatNotifyLifecycleBridgeInstalled) {
    return;
  }
  window.__chatNotifyLifecycleBridgeInstalled = true;

  const originalFetch = window.fetch;
  let sequence = 0;

  function isObservableRequest(input) {
    const url = typeof input === "string" ? input : input && input.url;
    return typeof url === "string" && url.includes("/backend-api/") && url.includes("conversation");
  }

  function getRequestMeta(input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method =
      (init && init.method) ||
      (input && input.method) ||
      "GET";
    return {
      url: String(url || ""),
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
    if (!isObservableRequest(input)) {
      return originalFetch.apply(this, arguments);
    }

    const lifecycleId = `fetch:${Date.now()}:${++sequence}`;
    const meta = getRequestMeta(input, init);

    postLifecycleEvent(Object.assign({ lifecycleId, phase: "started" }, meta));

    try {
      const response = await originalFetch.apply(this, arguments);

      if (!response.body || typeof ReadableStream === "undefined") {
        postLifecycleEvent(Object.assign({ lifecycleId, phase: "completed" }, meta));
        return response;
      }

      const reader = response.body.getReader();
      const monitoredBody = new ReadableStream({
        start(controller) {
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) {
                postLifecycleEvent(Object.assign({ lifecycleId, phase: "completed" }, meta));
                controller.close();
                return;
              }

              controller.enqueue(value);
              pump();
            }).catch((error) => {
              const phase = error && error.name === "AbortError" ? "canceled" : "failed";
              postLifecycleEvent(Object.assign({ lifecycleId, phase }, meta));
              controller.error(error);
            });
          }

          pump();
        },
        cancel(reason) {
          postLifecycleEvent(Object.assign({ lifecycleId, phase: "canceled" }, meta));
          return reader.cancel(reason);
        },
      });

      return new Response(monitoredBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const phase = error && error.name === "AbortError" ? "canceled" : "failed";
      postLifecycleEvent(Object.assign({ lifecycleId, phase }, meta));
      throw error;
    }
  };
})();
