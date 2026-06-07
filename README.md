# Chat Notify

[中文说明](README.zh-CN.md)

Chat Notify is a privacy-conscious browser extension that sends a browser/system notification when ChatGPT or Gemini finishes responding.

> Alpha status: this project is ready for early GitHub testing, but it is not yet published on the Chrome Web Store or Edge Add-ons.

## What It Does

- Starts monitoring only after you send a ChatGPT or Gemini message.
- Supports multiple active ChatGPT and Gemini sessions.
- Supports multiple tabs and same-tab conversation switching when the response lifecycle remains observable.
- Sends a browser/system notification when an observable response completes.
- Shows a short excerpt of your prompt in the notification.
- Click a completion notification to return to and focus the source tab.
- Shows popup status for the current page, extension, notification health, last completion, and Recent activity diagnostics.
- Recent activity shows where the latest monitoring flow reached.
- Keeps debug logs off by default.

The current Alpha supports ChatGPT and the regular Gemini web app:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://gemini.google.com/*`

Gemini support is MVP and targets `gemini.google.com`.

## Install

Recommended for early users: download the latest GitHub Release zip and follow the [Install guide](docs/INSTALL.md).

Current Alpha zip:

```text
chat-notify-0.2.0-alpha.1.zip
```

Developers can also clone this repository and load the project directory as an unpacked extension.

## Developer Setup

```bash
npm test
```

To load from source:

1. Open Chrome or Edge Chromium.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this repository directory.
6. Open ChatGPT or Gemini and send a message.

## Package A Release Zip

```bash
npm run package
```

The package script creates a clean extension zip under `dist/` for GitHub Releases. Maintainers should follow the [Release guide](docs/RELEASE.md).

The generated zip has `manifest.json` at the archive root so the unzipped folder can be selected directly with "Load unpacked".

For this Alpha, the generated release zip is `chat-notify-0.2.0-alpha.1.zip`.

## Privacy

Chat Notify does not upload, sync, or persist chat content. It does not use analytics, external servers, or cloud sync.

Notification prompt excerpts are short and are used to help identify the completed response.

Recent activity diagnostics are local and bounded. They may include a sanitized short prompt excerpt plus flow metadata such as the latest stage reached. They do not store full prompt contents, full chat content, assistant text, request or response bodies, tokens, or URLs.

Debug logs are disabled by default. When enabled, logs may include prompt excerpts for diagnostics, so avoid posting sensitive logs publicly.

## Troubleshooting

If notifications do not appear, check popup Recent activity first to see where the latest monitoring flow reached. Then enable debug logs for console details if needed. For detailed steps, see [Troubleshooting](docs/TROUBLESHOOTING.md).

Developers adapting new AI sites should start from sanitized probe evidence instead of guessing request behavior. See the [Adapter probe workflow](docs/ADAPTER_PROBE_WORKFLOW.md).

## Current Limits

- Gemini support is MVP and targets `gemini.google.com`.
- Chrome and Edge Chromium only.
- Alpha release zip must be installed manually.
- No Chrome Web Store or Edge Add-ons listing yet.
- No sound notifications.
- No webhook integrations.
- No cloud sync.

## Open Source

Chat Notify is released under the MIT License. Issues and early feedback are welcome once the repository is published on GitHub.
