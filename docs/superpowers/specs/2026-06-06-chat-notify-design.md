# Chat Notify Design

Date: 2026-06-06

## Product Positioning

Chat Notify is an open-source browser extension that notifies users when an AI chat web page finishes responding. The first version supports ChatGPT only, while the architecture is designed for future adapters for Claude, Gemini, Perplexity, and other AI chat products.

The first release should be small, auditable, privacy-conscious, and compatible with a future Chrome Web Store or Edge Add-ons release. It is not a general automation tool, chat archive, or prompt manager.

## MVP Scope

The MVP supports these behaviors:

- Monitor `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Start monitoring only after the user actively sends a new message.
- Support multiple ChatGPT tabs at the same time. Each tab tracks its own in-memory pending response.
- Notify when the corresponding ChatGPT response appears complete.
- Include a short excerpt of the user's prompt in the notification.
- Store the prompt excerpt only in the content script memory for that tab.
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

When a user sends a message in a ChatGPT tab, that tab begins monitoring the current response. The user can switch away or open other tabs. When the response completes, the browser displays a system notification.

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

Each supported chat page runs a content script. The content script selects a site adapter, starts a monitor controller, and tracks state for that tab only.

The content script does not create system notifications directly. It sends a completion event to the background service worker. The background service worker creates the browser notification.

The first version uses this state machine:

- `idle`: no active monitoring attempt.
- `pending_user_message`: the user appears to have sent a prompt; a short excerpt has been captured.
- `responding`: the page appears to be generating an assistant response.
- `settling`: generation appears to have stopped; the monitor waits for a short stability window.
- `completed`: the response is confirmed complete; a notification event is sent.
- `error_or_unknown`: the page cannot be interpreted reliably; the monitor abandons this attempt.

Expected transition flow:

1. The user clicks the send button or presses Enter in a way that sends a ChatGPT prompt.
2. The ChatGPT adapter extracts a prompt excerpt from the draft input or from the latest user message.
3. The monitor enters `pending_user_message`.
4. If ChatGPT enters a generating state, the monitor enters `responding`.
5. When the generating indicator disappears and the latest assistant content is stable for about 1.5 to 2 seconds, the monitor enters `settling` and then `completed`.
6. The content script sends an `AI_RESPONSE_COMPLETED` message to the background service worker.
7. The background service worker creates a notification.
8. The content script clears the prompt excerpt and returns to `idle`.

If the page does not enter a generating state within a short timeout, or if the adapter cannot identify the page state reliably, the monitor returns to `idle` without notifying.

## Multi-Tab Behavior

Multi-tab support is required in the MVP.

Each ChatGPT tab has its own content script and in-memory state machine. This means two or more ChatGPT tabs can be monitored independently. When a tab completes, it reports only its own completion event.

The background service worker should treat completion events as independent events. Notification IDs should include the tab ID and a timestamp or nonce so notifications from different tabs do not overwrite each other.

Opening a historical conversation, refreshing a page, or switching conversations must not create a notification unless a user-send event was detected first.

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
    adapters/
      adapter-contract.js
      chatgpt-adapter.js
    core/
      monitor-controller.js
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
- Create notification IDs that do not collide across tabs.
- Avoid storing prompt excerpts or chat content.

Future responsibility:

- Optionally focus the source tab when the user clicks a notification.

### Content Script

`src/content/content-script.js` is the page entry point.

Responsibilities:

- Select a matching adapter for the current page.
- Read the enabled setting from `chrome.storage`.
- Start or stop the monitor controller.
- Relay completion events to the background service worker.
- Avoid site-specific logic outside adapters.

### Adapter Contract

`src/adapters/adapter-contract.js` documents the interface every site adapter must satisfy.

Each adapter should provide:

- `siteId`
- `displayName`
- `matchesLocation(location)`
- `isSendEvent(event)`
- `getPromptDraft(root)`
- `getLatestUserMessage(root)`
- `isResponding(root)`
- `getLatestAssistantSnapshot(root)`
- `observePage(root, callback)`

The contract exists so future Claude, Gemini, and Perplexity support can be added by implementing new adapters instead of rewriting the monitor.

### ChatGPT Adapter

`src/adapters/chatgpt-adapter.js` contains all ChatGPT-specific DOM behavior.

Responsibilities:

- Recognize ChatGPT send actions.
- Extract the current user prompt or latest user message.
- Detect whether ChatGPT is generating.
- Snapshot the latest assistant response text.
- Observe relevant page mutations.

This file is expected to be the most likely to change when ChatGPT changes its UI.

### Monitor Controller

`src/core/monitor-controller.js` connects the selected adapter to the state machine.

Responsibilities:

- Listen for user-send events.
- Capture prompt excerpts.
- Poll or react to adapter page observations.
- Feed abstract events into the state machine.
- Emit a completion event once per user-sent prompt.
- Clean up timers and observers.

### State Machine

`src/core/state-machine.js` is pure logic and should be unit-tested.

Responsibilities:

- Define valid states and transitions.
- Enforce timeouts.
- Prevent duplicate completion events.
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
- Prompt excerpts live only in a tab's content script memory.
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
- Open an existing historical conversation and confirm no notification appears.
- Refresh a ChatGPT page and confirm no notification appears.
- Switch away from the ChatGPT tab during generation and confirm notification still appears.
- Disable the extension in the popup and confirm no notification appears.
- Use the popup test notification button and confirm it works.

## Known Risks

ChatGPT DOM changes can break monitoring. This risk is contained by keeping selectors and page-specific behavior inside `chatgpt-adapter.js`.

False notifications can happen if page changes are mistaken for new replies. This is reduced by requiring a user-send event before monitoring can begin.

Missed notifications can happen if ChatGPT changes its generating indicators. This is reduced by combining multiple signals: send event, generating state, assistant snapshot changes, and a settling window.

Prompt excerpts in notifications can expose sensitive text on the local machine. This is accepted for the MVP because the user requested useful multi-tab identification. The privacy boundary is local memory only, no storage, and no upload. A future setting can disable excerpts.

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
- Monitor multiple ChatGPT tabs independently.
- Include a short prompt excerpt in notifications.
- Avoid storing or uploading chat content.
- Keep site-specific DOM logic isolated in the ChatGPT adapter.
- Provide tested core state-machine and prompt-excerpt logic.
