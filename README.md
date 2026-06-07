# Chat Notify

[中文说明](README.zh-CN.md)

Chat Notify is a privacy-conscious browser extension that sends a browser/system notification when ChatGPT finishes responding.

> Alpha status: this project is ready for early GitHub testing, but it is not yet published on the Chrome Web Store or Edge Add-ons.

## What It Does

- Starts monitoring only after you send a ChatGPT message.
- Supports multiple active ChatGPT sessions.
- Supports multiple tabs and same-tab conversation switching when the response lifecycle remains observable.
- Sends a browser/system notification when an observable response completes.
- Shows a short excerpt of your prompt in the notification.
- Click a completion notification to return to and focus the source ChatGPT tab.
- Shows popup status for the current page, extension, notification health, and last completion.
- Keeps debug logs off by default.

The Alpha supports ChatGPT only:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

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
6. Open ChatGPT and send a message.

## Package A Release Zip

```bash
npm run package
```

The package script creates a clean extension zip under `dist/` for GitHub Releases. Maintainers should follow the [Release guide](docs/RELEASE.md).

The generated zip has `manifest.json` at the archive root so the unzipped folder can be selected directly with "Load unpacked".

For this Alpha, the generated release zip is `chat-notify-0.2.0-alpha.1.zip`.

## Privacy

Chat Notify does not upload, sync, or persist chat content. It does not use analytics, external servers, or cloud sync.

Prompt excerpts are kept only in local extension memory for the active response and are cleared after notification, cancellation, timeout, or abandonment.

Debug logs are disabled by default. When enabled, logs may include prompt excerpts for diagnostics, so avoid posting sensitive logs publicly.

## Troubleshooting

If notifications do not appear, first use the popup "Test notification" button. For detailed steps, see [Troubleshooting](docs/TROUBLESHOOTING.md).

## Current Limits

- ChatGPT only.
- Chrome and Edge Chromium only.
- Alpha release zip must be installed manually.
- No Chrome Web Store or Edge Add-ons listing yet.
- No sound notifications.
- No webhook integrations.
- No cloud sync.

## Open Source

Chat Notify is released under the MIT License. Issues and early feedback are welcome once the repository is published on GitHub.
