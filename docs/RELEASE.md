# Release Guide

This guide is for maintainers preparing a GitHub Alpha release.

## Version

This Alpha release is `0.2.0-alpha.1`.

`package.json` uses the Alpha version for npm scripts and zip naming. `manifest.json` uses `0.2.0` because Chrome extension manifests require a numeric dotted version and do not accept prerelease strings.

## Before Packaging

Run:

```bash
npm test
```

Expected result: all tests pass.

## Package

Run:

```bash
npm run package
```

Expected artifact:

```text
dist/chat-notify-0.2.0-alpha.1.zip
```

## Inspect The Zip

List the artifact contents:

```bash
unzip -Z1 dist/chat-notify-0.2.0-alpha.1.zip
```

The output should list paths without a leading `dist/extension/` prefix. `manifest.json` should be at the zip root.

Confirm the zip contains extension runtime files such as:

- `manifest.json`
- `src/`
- `assets/`
- `LICENSE`

Confirm the zip does not contain:

- `.git/`
- `node_modules/`
- `tests/`
- `docs/`
- `coverage/`
- local OS metadata files

## Local Smoke Test

1. Unzip the artifact into a temporary folder.
2. Open `chrome://extensions` or `edge://extensions`.
3. Load the unzipped folder with "Load unpacked".
4. Use the popup "Test notification" button.
5. Confirm the test notification updates the popup notification status.
6. Send a short ChatGPT prompt and confirm a completion notification appears.
7. Click the completion notification and confirm it focuses the source ChatGPT tab.
8. Confirm the popup shows page, extension, notification health, and last completion status.

## Create GitHub Release

1. Create a tag named `v0.2.0-alpha.1`.
2. Create a GitHub Release from the tag.
3. Attach `dist/chat-notify-0.2.0-alpha.1.zip`.
4. Mention that this is a manual-install Alpha.
5. Link to `docs/INSTALL.md` and `docs/TROUBLESHOOTING.md`.

## Alpha Release Notes Template

```text
Chat Notify 0.2.0-alpha.1

This Alpha supports ChatGPT response completion notifications for Chrome and Edge Chromium.

Highlights:
- Click a completion notification to focus the source ChatGPT tab.
- Popup status now shows page, extension, notification health, and last completion state.

Install:
- Download chat-notify-0.2.0-alpha.1.zip.
- Unzip it.
- Load the unzipped folder from chrome://extensions or edge://extensions with Developer mode enabled.

Known limits:
- ChatGPT only.
- Manual installation only.
- No Chrome Web Store listing yet.
```
