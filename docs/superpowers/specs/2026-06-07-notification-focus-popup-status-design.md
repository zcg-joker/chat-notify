# Notification Focus And Popup Status Design

Date: 2026-06-07

## Product Goal

This iteration improves the Alpha user experience in two focused ways:

- Clicking a completion notification returns the user to the source browser tab.
- The popup shows clearer operational status so users can tell whether notifications are working and what recently happened.

The release target is `0.2.0-alpha.1`. This is still a manual-install GitHub Alpha release, not a Chrome Web Store release.

## Scope

Included:

- Bind each ChatGPT completion notification to the source tab when a tab id is available.
- On notification click, focus the source window and activate the source tab.
- Keep click behavior best-effort: if the tab or window no longer exists, fail silently except for debug logs.
- Preserve test notification behavior: test notifications are not bound to a tab and do not focus a page on click.
- Add a popup status area for current page support, enabled state, notification health, and recent completion notification outcome.
- Make the popup test notification button show immediate success or failure status.
- Persist only non-sensitive status metadata.

Excluded:

- Do not navigate back to the original ChatGPT conversation URL.
- Do not store or show prompt excerpts in popup history.
- Do not show pending session counts.
- Do not build a full options page.
- Do not add support for another AI site.
- Do not add sound, webhook, or cloud sync behavior.

## Notification Click Behavior

When a completion notification is created, the background service worker should store a target record keyed by `notificationId`.

The target record should contain:

- `notificationId`
- `tabId`
- `windowId`, when known or retrievable
- `createdAt`

The record must not contain:

- Prompt excerpts
- Chat content
- Conversation URL
- Assistant text

When the user clicks a notification:

1. Look up the target record by `notificationId`.
2. If no record exists, do nothing.
3. If a `windowId` exists, call `chrome.windows.update(windowId, { focused: true })`.
4. Call `chrome.tabs.update(tabId, { active: true })`.
5. Clear the notification target record for that notification.

If focusing the window or tab fails because the tab/window was closed, the service should log the failure only when debug logs are enabled and then clear the target record. The extension should not create another notification or show an error popup for a click failure.

The implementation should account for MV3 service worker suspension. Notification target records should therefore not live only in process memory. Use `chrome.storage.session` when available. If `chrome.storage.session` is unavailable in a test or older runtime, the code may fall back to in-memory storage for the current service worker lifetime.

## Popup Status Behavior

The popup should remain compact, but it should provide clearer signals:

- Current page:
  - `ChatGPT supported`
  - `Unsupported page`
  - `Unable to inspect current page`
- Extension:
  - `Enabled`
  - `Disabled`
- Notifications:
  - `Not tested yet`
  - `Notifications working`
  - `Notification failed`
- Last completion:
  - `No completions yet`
  - `Last notification sent`
  - `Last notification failed`

The popup should still include:

- Enabled toggle
- Debug logs toggle
- Test notification button
- Privacy note

When the user clicks `Test notification`, the popup should:

1. Send the existing test notification message.
2. Read the background response.
3. Update the notification status immediately:
   - success: `Notifications working`
   - failure: `Notification failed`
4. Avoid exposing low-level stack traces in the main popup UI.

The popup may show a short plain error reason if Chrome returns one, for example `notifications permission missing`.

## Background Status Model

The background service worker should maintain a small status object in extension storage.

Recommended shape:

```js
{
  notificationHealth: {
    state: "not_tested" | "working" | "failed",
    message: "",
    updatedAt: 1780761600000
  },
  lastCompletion: {
    state: "none" | "sent" | "failed",
    siteId: "chatgpt",
    updatedAt: 1780761600000
  }
}
```

This status must not include prompt excerpts, session keys, URLs, request bodies, response bodies, auth tokens, cookies, or assistant text.

Storage choice:

- `chrome.storage.local` is appropriate because this is device-local operational metadata.
- Tests should be able to inject fake storage APIs.
- If storage is unavailable, background handlers should still return message responses and notification behavior should continue best-effort.

The popup should request this status with the existing `GET_POPUP_STATUS` message type. The background should respond with:

```js
{
  ok: true,
  status: {
    notificationHealth: { ... },
    lastCompletion: { ... }
  }
}
```

## Permissions

The extension will need the Chrome `tabs` permission to focus a tab by id from the background service worker. The existing `storage` and `notifications` permissions remain required.

No new host permissions are needed.

## Privacy And Safety

This feature must preserve the current privacy posture:

- No chat content persistence.
- No prompt excerpt persistence for popup status.
- No conversation URL persistence for notification click targets.
- No analytics or network calls.
- Debug logs remain off by default.

The popup should help diagnose operational status without becoming a chat activity log.

## Testing Requirements

Automated tests should cover:

- Completion notification creation stores a click target when `sourceTabId` is available.
- Clicking a bound completion notification focuses the window and activates the tab.
- Clicking an unknown notification does nothing.
- Closed/missing tab or window failures are handled without throwing.
- Test notifications are not bound to a tab.
- Completion notification success updates `lastCompletion` status.
- Completion notification failure updates `lastCompletion` failure status.
- Test notification success/failure updates notification health status.
- Popup requests background status and renders notification health and last completion.
- Popup test notification click updates UI based on background response.
- Manifest includes the required `tabs` permission.

Manual validation should cover:

- Send a ChatGPT prompt, wait for notification, click notification, confirm the ChatGPT tab becomes active.
- Close the source tab before clicking a notification and confirm no user-visible error occurs.
- Open popup before and after clicking `Test notification` and confirm status changes.
- Disable the extension in popup and confirm the extension status displays disabled.

