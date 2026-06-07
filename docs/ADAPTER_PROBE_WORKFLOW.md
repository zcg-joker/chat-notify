# Adapter Probe Workflow

Use this workflow when adding or fixing support for an AI chat website.

The goal is to adapt from evidence. First capture a small sanitized probe report, then decide which requests and page signals are stable enough for an adapter.

## Capture A Probe Report

1. Load Chat Notify as an unpacked extension.
2. Open a supported page, or temporarily add the target host to the development manifest while investigating an unsupported site.
3. Open the popup and turn on "Debug logs" only if console details are needed.
4. Send one short non-sensitive prompt.
5. Wait until the AI response completes or the bug reproduces.
6. Open the popup and click "Copy diagnostics".
7. Paste the copied JSON into a private debugging note or issue.

Do not copy raw request bodies, raw response bodies, cookies, local storage, request headers, response headers, bearer tokens, Authorization values, or full chat content.

## What The Report Contains

The copied report is intentionally small and adapter-focused.

- `currentPage.host`: the current hostname, without the full URL, query string, or conversation id.
- `currentPage.supported`: whether the popup recognizes the current page as supported.
- `settings.enabled`: whether Chat Notify was enabled when the report was copied.
- `settings.debugLogs`: whether debug logs were enabled.
- `latestFlow.siteId`: the adapter that handled the latest observed flow.
- `latestFlow.promptExcerpt`: a short sanitized prompt excerpt.
- `latestFlow.summary.totalEvents`: number of stored diagnostic events.
- `latestFlow.summary.requestProbeCount`: number of request probe events in the flow.
- `latestFlow.summary.matchedRequestCount`: number of requests that matched the adapter's generation matcher.
- `latestFlow.summary.ignoredRequestCount`: number of observed requests ignored by the adapter.
- `latestFlow.summary.lifecycleEventTypes`: lifecycle stages observed by the bridge.
- `latestFlow.summary.notificationEventTypes`: notification stages observed by the background worker.
- `latestFlow.matchedRequests`: sanitized request metadata for matched generation candidates.
- `latestFlow.ignoredRequests`: sanitized request metadata for ignored request candidates.
- `latestFlow.events`: compact event timeline with sanitized request metadata only.

The report must not contain request or response bodies, headers, tokens, cookies, full URLs, URL query strings, assistant text, or full prompt contents.

## Interpret The Request Probe

Start with `matchedRequests`.

A good generation matcher usually has:

- A stable host owned by the AI product.
- A stable path or RPC identifier.
- A method that matches generation behavior, often `POST`.
- A response body or stream that stays pending until the user-visible generation is complete.

Then inspect `ignoredRequests`.

Ignored requests help identify noise that should remain excluded, for example:

- Telemetry paths.
- Analytics paths.
- Beacon or sentinel paths.
- Conversation list refreshes.
- Prepare or warmup requests that happen before generation.
- Static asset or metadata requests.

For ChatGPT-like sites, ignore telemetry-style paths such as `/ces/`, `/stats`, `/telemetry`, `/sentinel`, and prepare-only endpoints unless a report proves they are part of the generation lifecycle.

For Gemini-like sites, prefer the RPC endpoint that stays active for the model response instead of short metadata or autocomplete requests.

## Adapter Checklist

Before implementing or changing an adapter, collect evidence for each item:

- Host matcher: exact hostnames or suffixes the adapter should support.
- Session key strategy: stable conversation id from the URL when available, otherwise a temporary per-tab key.
- Send detection: the button, keyboard event, or editor state that proves the user actively submitted a prompt.
- Prompt extraction: visible editor draft first, request-body fallback only when safely sanitized.
- Generation request matcher: host, method, path, and optional RPC identifiers.
- Completion strategy: request stream completion, plus any UI settling guard needed for thinking or multi-phase models.
- Noise filters: telemetry, prepare, metadata, and list-refresh requests that should not appear in Recent activity unless no meaningful event exists.
- Failure behavior: timeout, cancellation, request failure, and unsupported page handling.
- Notification behavior: one notification per completed user-initiated response, with source tab focus metadata when available.
- Privacy boundary: no full prompt, assistant text, raw request body, raw response body, headers, cookies, tokens, or full URLs.

## Unsupported Site Workflow

For an unsupported site, the production extension should not observe every website by default.

Use one of these development-only approaches:

- Temporarily add the target host to `manifest.json` and run the normal capture flow.
- Add a future permission-controlled probe mode that enables specific hosts only after the developer or user opts in.

Keep host permissions narrow. Do not broaden the manifest to all websites just to make adapter discovery easier.

## Debugging Patterns

If `requestProbeCount` is `0`, the content script may not be loaded on that host, the bridge may not be injected, or the site may use a mechanism the bridge does not observe yet.

If `matchedRequestCount` is `0` but `ignoredRequestCount` is high, the adapter matcher is probably too strict or the real generation request is being filtered as noise.

If `lifecycleEventTypes` contains a start event but no completion event, inspect whether the response stream is still open, whether a request failed, or whether the page uses separate phases for thinking and final output.

If `notificationEventTypes` does not include `notification_sent` after lifecycle completion, inspect extension settings, notification permission, and background service worker logs.

If the prompt excerpt is stale, prefer extracting from the generation request that matched the lifecycle rather than from the current editor after the page has changed.

## Minimal Evidence For A New Adapter

Before adding a new AI site adapter, keep one sanitized report for:

- A short normal response.
- A longer response.
- A response where the user switches away from the tab.
- Same-tab conversation switching, if the site supports it.
- A failed or canceled generation, if the site exposes one.

These reports do not need to be committed, but they should inform tests and adapter comments.
