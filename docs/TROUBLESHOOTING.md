# Troubleshooting

Use this guide when Chat Notify does not behave as expected.

## Test Notification Does Not Appear

1. Open the Chat Notify popup.
2. Click "Test notification".
3. Confirm that browser notifications are allowed.
4. Confirm that operating system notifications are allowed for your browser.
5. Reload the extension from `chrome://extensions` or `edge://extensions`.

If the test notification fails, ChatGPT monitoring will not be able to show notifications either.

## ChatGPT Response Completion Notification Does Not Appear

1. Confirm Chat Notify is enabled in the popup.
2. Confirm you are on `https://chatgpt.com/` or `https://chat.openai.com/`.
3. Send a new prompt. Historical conversations should not trigger notifications.
4. Wait until the response is fully complete.
5. Try the popup "Test notification" button.
6. Reload the extension and the ChatGPT tab.

The Alpha intentionally fails closed: if Chat Notify cannot confidently observe a completion, it should avoid sending a misleading notification.

## Completion Notification Click Does Not Focus The Tab

1. Check whether the source ChatGPT tab or browser window was closed before clicking the notification.
2. Confirm the notification came from a new ChatGPT response completion, not the popup test notification.
3. Turn on "Debug logs", reproduce the completion, click the notification, and check page console and service worker logs for notification click failures.
4. Turn "Debug logs" off again after testing.

## Prompt Excerpt Looks Wrong

Prompt excerpts should come from the message request that started the response. If an excerpt looks stale or incorrect:

1. Turn on "Debug logs" in the popup.
2. Send a short test prompt that does not contain private information.
3. Check the page console for `[Chat Notify]` logs.
4. Turn "Debug logs" off again after testing.

Do not paste full chat content into public GitHub issues.

## Debug Logs

Debug logs are off by default.

To enable them:

1. Open the Chat Notify popup.
2. Turn on "Debug logs".
3. Reproduce the issue.
4. Turn "Debug logs" off.

Debug logs may include prompt excerpts. Do not paste full chat content or sensitive prompt excerpts into public issue reports.

Debug logs can also help diagnose notification click failures, including missing source tab or window details.

## Page Console Logs

1. Open the ChatGPT tab.
2. Open browser DevTools.
3. Select the Console tab.
4. Look for messages beginning with `[Chat Notify]`.

## Service Worker Logs

1. Open `chrome://extensions` or `edge://extensions`.
2. Find Chat Notify.
3. Click the service worker inspection link.
4. Look for messages beginning with `[Chat Notify]`.

## Extension Appears Stale

If changes do not appear after installing a new build:

1. Open `chrome://extensions` or `edge://extensions`.
2. Click "Reload" on Chat Notify.
3. Reload the ChatGPT browser tab.
4. If using a release zip, confirm that the loaded folder is the new unzipped folder.

## Opening A GitHub Issue

Include:

- Browser name and version.
- Chat Notify version.
- Whether the test notification works.
- Whether debug logs were enabled.
- A short description of what happened.

Do not paste full chat content, access tokens, cookies, or private prompts.
