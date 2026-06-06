# Chat Notify

Chat Notify is a privacy-conscious browser extension that notifies you when ChatGPT finishes responding.

The MVP supports ChatGPT on:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## What It Does

- Starts monitoring only after you send a ChatGPT message.
- Supports multiple active ChatGPT sessions.
- Supports multiple tabs and same-tab conversation switching when the response lifecycle remains observable.
- Sends a browser/system notification when an observable response completes.
- Shows a short excerpt of your prompt in the notification.

## Privacy

Chat Notify does not upload, sync, or persist chat content.

Prompt excerpts are kept only in local extension memory for the pending response. They are cleared after completion, cancellation, timeout, or abandonment. The extension does not make network requests to project-owned or third-party servers.

## Install For Local Development

1. Open Chrome or Edge Chromium.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this repository directory.
6. Open ChatGPT and send a message.

## Test

```bash
npm test
```

## Manual Validation

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

## Current Limits

- ChatGPT only.
- Chrome and Edge Chromium only.
- No sound notifications.
- No webhook integrations.
- No cloud sync.
