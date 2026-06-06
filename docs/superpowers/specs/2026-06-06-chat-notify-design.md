# Chat Notify Design

Date: 2026-06-06

## Product Positioning

Chat Notify is an open-source browser extension that notifies users when an AI chat web page finishes responding. The first version supports ChatGPT only, while the architecture is designed for future adapters for Claude, Gemini, Perplexity, and other AI chat products.

The first release should be small, auditable, privacy-conscious, and compatible with a future Chrome Web Store or Edge Add-ons release. It is not a general automation tool, chat archive, prompt manager, or background ChatGPT client.

## MVP Scope

The MVP supports these behaviors:

- Monitor `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Start monitoring only after the user actively sends a new message.
- Support multiple active ChatGPT sessions at the same time.
- Support multi-tab monitoring and same-tab multi-conversation monitoring. These are complementary requirements, not alternatives.
- Notify when the corresponding ChatGPT response appears complete.
- Include a short excerpt of the user's prompt in the notification.
- Store the prompt excerpt only in memory for the pending session record.
- Clear the excerpt after the notification is sent or the monitoring attempt is abandoned.
- Provide a lightweight popup with enabled status, supported-site status, a test notification button, and a brief privacy note.

The MVP intentionally excludes:

- Sound notifications.
- Webhooks or third-party integrations.
- Cloud sync.
- Account systems.
- Persistent chat content storage.
- User-configurable selectors.
- Support for non-Chrome-extension browsers such as Firefox.
- AI sites other than ChatGPT.

## User Experience

The extension name is `Chat Notify`, not `ChatGPT Notify`, so the product language can grow beyond ChatGPT later.

When a user sends a message in a ChatGPT conversation, the extension begins monitoring that session's current response. The user can switch away, open another tab, or move to another conversation in the same tab. When an observable response completes, the browser displays a system notification for the corresponding session.

Notification example when an excerpt exists:

```text
Title: ChatGPT response complete
Message: "Summarize this paper..." is ready
```

Notification fallback when no excerpt can be extracted:

```text
Title: ChatGPT response complete
Message: Your response is ready
```

The popup should stay minimal in the MVP:

- Extension enabled or disabled.
- Current page supported or unsupported.
- Test notification button.
- Short privacy note explaining that prompt excerpts are kept locally in memory and are not uploaded or stored.

## Monitoring Model

Each supported chat page runs a content script. The content script selects a site adapter, starts a monitor controller, and tracks pending responses by session key instead of by tab.

The content script does not create system notifications directly. It sends completion, cancellation, and abandonment events to the background service worker. The background service worker creates browser notifications only for completion events.

The first version uses this state machine for each pending session:

- `idle`: no active monitoring attempt.
- `pending_user_message`: the user appears to have sent a prompt; a short excerpt has been captured.
- `responding`: the page appears to be generating an assistant response.
- `settling`: generation appears to have stopped; the monitor waits for a short stability window.
- `completed`: the response is confirmed complete; a notification event is sent.
- `canceled`: the generation lifecycle ended because the site canceled or aborted the response; no completion notification is sent.
- `error_or_unknown`: the page cannot be interpreted reliably; the monitor abandons this attempt.

Expected transition flow:

1. The user clicks the send button or presses Enter in a way that sends a ChatGPT prompt.
2. The ChatGPT adapter extracts a prompt excerpt from the draft input or from the latest user message.
3. The session tracker assigns a `sessionKey` from the current ChatGPT conversation URL or a temporary key for a new conversation.
4. The monitor creates or updates a pending record for that session and enters `pending_user_message`.
5. If ChatGPT enters a generating state for that session, the monitor enters `responding`.
6. When the generation lifecycle ends successfully and the latest assistant content is stable for about 1.5 to 2 seconds when visible, the monitor enters `settling` and then `completed`.
7. The content script sends an `AI_RESPONSE_COMPLETED` message to the background service worker.
8. The background service worker creates a notification.
9. The content script clears the prompt excerpt and removes the pending session record.

If the page does not enter a generating state within a short timeout, or if the adapter cannot identify the page state reliably, the monitor returns to `idle` without notifying.

If the site aborts the generation because the user switches conversations, stops generation, reloads, or closes the tab, the monitor marks that session `canceled` or abandoned and does not send a completion notification.

## Multi-Session Behavior

Multi-session support is required in the MVP, and multi-tab support remains required. The session-scoped model expands the original tab-scoped model; it does not replace multi-tab behavior.

The business concurrency unit is a ChatGPT session or conversation. The browser tab is still tracked as the source context for page observation, notification routing, and future click-to-focus behavior. A session can be active in its own tab, or it can be one of several conversations the user starts from the same tab over time.

The monitor keeps a `pendingSessions` map:

```text
Map<sessionKey, PendingResponse>
```

Each `PendingResponse` stores:

- `siteId`
- `sessionKey`
- `sourceTabId`
- `promptExcerpt`
- `status`
- `startedAt`
- `lastSeenAt`
- latest visible assistant snapshot, when available

The `sessionKey` should come from the ChatGPT conversation URL when possible. For a new conversation before ChatGPT assigns a conversation ID, the monitor may use a temporary key and migrate the pending record when a stable conversation ID appears.

The background service worker should treat completion events as independent events. Notification IDs should include the site ID, session key, source tab ID, and a timestamp or nonce so notifications from different sessions do not overwrite each other.

Opening a historical conversation, refreshing a page, or switching conversations must not create a notification unless a user-send event was detected first for that session.

DOM-only monitoring is not sufficient for same-tab multi-session behavior because the previous conversation's DOM may disappear when the user navigates to another conversation. The MVP therefore uses two layers:

- DOM layer: captures user-send events, prompt excerpts, current conversation identity, and visible assistant snapshots.
- Generation lifecycle layer: observes the underlying response lifecycle for each session when the site exposes enough information in the active page runtime.

If ChatGPT keeps the previous session's generation running while the user navigates to another conversation in the same tab, the lifecycle layer should still be able to complete that session. If ChatGPT cancels the previous generation during navigation, the extension must treat it as canceled or abandoned rather than completed.

## Architecture

The MVP should use a plain Manifest V3 Chrome extension without a build tool. This keeps installation simple and makes the source easy to audit. A future TypeScript or Vite build can be introduced when the popup, settings, or adapter system becomes more complex.

Suggested file structure:

```text
chatNotify/
  manifest.json
  README.md
  docs/
    superpowers/
      specs/
        2026-06-06-chat-notify-design.md
  src/
    background/
      service-worker.js
    content/
      content-script.js
      page-lifecycle-bridge.js
    adapters/
      adapter-contract.js
      chatgpt-adapter.js
    core/
      monitor-controller.js
      session-tracker.js
      state-machine.js
      prompt-excerpt.js
      dom-watch.js
    popup/
      popup.html
      popup.css
      popup.js
    shared/
      constants.js
      messages.js
  tests/
    state-machine.test.js
    prompt-excerpt.test.js
```

### Background Service Worker

`src/background/service-worker.js` receives extension messages and creates notifications through `chrome.notifications.create`.

Responsibilities:

- Handle `AI_RESPONSE_COMPLETED`.
- Handle popup test notification requests.
- Create notification IDs that do not collide across sessions or tabs.
- Avoid storing prompt excerpts or chat content.

Future responsibility:

- Optionally focus the source tab when the user clicks a notification.

### Content Script

`src/content/content-script.js` is the page entry point.

Responsibilities:

- Select a matching adapter for the current page.
- Read the enabled setting from `chrome.storage`.
- Start or stop the monitor controller.
- Install the page lifecycle bridge when the adapter requires page-runtime signals.
- Relay completion events to the background service worker.
- Avoid site-specific logic outside adapters.

### Page Lifecycle Bridge

`src/content/page-lifecycle-bridge.js` observes response lifecycle signals that are not available through ordinary DOM mutation alone.

Responsibilities:

- Run in the page context when needed so it can observe ChatGPT's request lifecycle.
- Detect generation start, successful completion, cancellation, and failure when those events can be inferred.
- Forward sanitized lifecycle events to the isolated content script.
- Avoid forwarding full prompt text, assistant text, request bodies, response bodies, auth tokens, or headers.
- Keep the bridge narrow and site-specific enough to audit.

This bridge is required because same-tab session switching can remove the previous conversation from the DOM while its generation may still be running. If Chrome extension platform constraints or ChatGPT implementation changes prevent reliable lifecycle observation, the monitor should fail closed and avoid sending a completion notification.

### Adapter Contract

`src/adapters/adapter-contract.js` documents the interface every site adapter must satisfy.

Each adapter should provide:

- `siteId`
- `displayName`
- `matchesLocation(location)`
- `getSessionKey(location, root)`
- `canObserveLifecycle`
- `isSendEvent(event)`
- `getPromptDraft(root)`
- `getLatestUserMessage(root)`
- `isResponding(root)`
- `getLatestAssistantSnapshot(root)`
- `observePage(root, callback)`
- `normalizeLifecycleEvent(event)`

The contract exists so future Claude, Gemini, and Perplexity support can be added by implementing new adapters instead of rewriting the monitor.

### ChatGPT Adapter

`src/adapters/chatgpt-adapter.js` contains all ChatGPT-specific DOM behavior.

Responsibilities:

- Recognize ChatGPT send actions.
- Extract the current user prompt or latest user message.
- Resolve the current conversation ID from URL or page state.
- Detect whether ChatGPT is generating.
- Snapshot the latest assistant response text.
- Observe relevant page mutations.
- Normalize ChatGPT response lifecycle events into session-scoped monitor events.

This file is expected to be the most likely to change when ChatGPT changes its UI.

### Monitor Controller

`src/core/monitor-controller.js` connects the selected adapter to the state machine.

Responsibilities:

- Listen for user-send events.
- Capture prompt excerpts.
- Create and update pending session records.
- Poll or react to adapter page observations.
- Consume page lifecycle bridge events.
- Feed abstract events into the state machine.
- Emit a completion event once per user-sent prompt.
- Clean up timers and observers.

### Session Tracker

`src/core/session-tracker.js` manages pending response records by session key.

Responsibilities:

- Create temporary session keys for new conversations.
- Migrate temporary keys to stable conversation IDs when available.
- Keep pending sessions independent from browser tabs.
- Track the source tab for notification focus behavior and diagnostics.
- Clear prompt excerpts when a pending session completes, cancels, times out, or is abandoned.

### State Machine

`src/core/state-machine.js` is pure logic and should be unit-tested.

Responsibilities:

- Define valid states and transitions.
- Enforce timeouts.
- Prevent duplicate completion events.
- Distinguish completed responses from canceled or abandoned responses.
- Prefer dropping uncertain attempts over notifying incorrectly.

### Prompt Excerpt

`src/core/prompt-excerpt.js` normalizes and truncates prompt text.

Default behavior:

- Trim leading and trailing whitespace.
- Collapse repeated whitespace into a single space.
- Truncate to 40 visible characters.
- Add an ellipsis only when truncation occurs.
- Return an empty value when no meaningful text exists.

## Permissions And Privacy

The MVP should request only these permissions:

```json
{
  "permissions": ["notifications", "storage"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ]
}
```

`notifications` is required to show browser/system notifications.

`storage` is used only for extension settings, such as `enabled: true` or `enabled: false`. It must not be used to store chat content or prompt excerpts.

Privacy requirements:

- No remote code.
- No analytics.
- No network requests to project-owned or third-party servers.
- No upload or sync of chat content.
- No persistent storage of prompt excerpts.
- Prompt excerpts live only in the in-memory pending session record.
- Prompt excerpts are cleared after completion, timeout, or monitor abandonment.
- README and popup copy must state these constraints plainly.

Host permissions should remain specific. Future site support should add explicit host permissions per site instead of using `<all_urls>`.

## Error Handling

The monitor should avoid noisy behavior.

If the adapter cannot identify a send event, no monitoring starts.

If a send event is detected but no response generation is detected within the configured timeout, the attempt is abandoned.

If the assistant snapshot cannot be read or remains ambiguous, the attempt is abandoned after timeout.

If background notification creation fails, the content script still clears the prompt excerpt because it must not retain chat content longer than needed.

The extension should prefer missed notifications over false notifications.

## Testing Strategy

Automated tests should cover pure logic first.

`tests/state-machine.test.js` should cover:

- `idle -> pending_user_message`
- `pending_user_message -> responding`
- `responding -> settling`
- `settling -> completed`
- cancellation from any active state without notification
- timeout from `pending_user_message` back to `idle`
- timeout from `responding` back to `idle`
- duplicate completion prevention
- uncertain states producing no notification

`tests/prompt-excerpt.test.js` should cover:

- Chinese text
- English text
- mixed Chinese and English text
- repeated whitespace
- long text truncation
- empty or whitespace-only text

Manual validation should cover:

- Load the unpacked extension in Chrome.
- Send a short ChatGPT prompt and confirm one notification after completion.
- Open two ChatGPT tabs, send prompts in both, and confirm two independent notifications.
- In one ChatGPT tab, send a prompt in Conversation A, switch to Conversation B, send another prompt, and confirm both observable completions notify independently.
- In one ChatGPT tab, send a prompt in Conversation A, switch to Conversation B, and confirm no completion notification appears for A if ChatGPT canceled A's generation.
- Open an existing historical conversation and confirm no notification appears.
- Refresh a ChatGPT page and confirm no notification appears.
- Switch away from the ChatGPT tab during generation and confirm notification still appears.
- Disable the extension in the popup and confirm no notification appears.
- Use the popup test notification button and confirm it works.

## Known Risks

ChatGPT DOM changes can break visible-page monitoring. This risk is contained by keeping selectors and page-specific behavior inside `chatgpt-adapter.js`.

ChatGPT request lifecycle changes can break same-tab multi-session monitoring. This risk is contained by keeping request lifecycle normalization narrow and adapter-owned. The extension should fail closed if lifecycle events cannot be tied to a session.

False notifications can happen if page changes are mistaken for new replies. This is reduced by requiring a user-send event before monitoring can begin.

Missed notifications can happen if ChatGPT changes its generating indicators. This is reduced by combining multiple signals: send event, generating state, assistant snapshot changes, and a settling window.

Prompt excerpts in notifications can expose sensitive text on the local machine. This is accepted for the MVP because the user requested useful session identification. The privacy boundary is local memory only, no storage, and no upload. A future setting can disable excerpts.

Chrome and Edge Chromium are the initial target browsers. Firefox compatibility is deferred.

## Future Extensions

Future releases can add:

- Claude adapter.
- Gemini adapter.
- Perplexity adapter.
- Notification click-to-focus-tab behavior.
- User setting to hide prompt excerpts.
- Optional sound notification.
- Optional webhook integrations.
- Adapter health diagnostics.
- Static HTML fixtures for adapter contract tests.
- TypeScript and a build step if the codebase becomes large enough to justify it.

## Acceptance Criteria

The design is successful when the MVP can:

- Run as a local unpacked Manifest V3 extension.
- Monitor ChatGPT only.
- Notify only after user-sent prompts.
- Monitor multiple ChatGPT sessions independently, including multiple tabs and same-tab conversation switches when the generation lifecycle remains observable.
- Include a short prompt excerpt in notifications.
- Avoid storing or uploading chat content.
- Keep site-specific DOM logic isolated in the ChatGPT adapter.
- Provide tested core state-machine and prompt-excerpt logic.
