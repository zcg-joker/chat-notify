# Install Chat Notify

This guide is for the Alpha version of Chat Notify. The extension is not yet available in the Chrome Web Store or Edge Add-ons, so it must be loaded manually.

The current Alpha supports ChatGPT and the regular Gemini web app. Gemini support is MVP and targets `https://gemini.google.com/`.

## Install From A GitHub Release Zip

1. Open the Chat Notify GitHub Releases page.
2. Download the latest GitHub Release zip, for example `chat-notify-0.2.0-alpha.1.zip`.
3. Unzip the file.
4. Remember the unzipped folder location. You will select this folder in the browser.

## Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on Developer mode.
4. Click "Load unpacked".
5. Select the unzipped Chat Notify folder.
6. Confirm that Chat Notify appears in the extension list.

## Edge

1. Open Microsoft Edge.
2. Go to `edge://extensions`.
3. Turn on Developer mode.
4. Click "Load unpacked".
5. Select the unzipped Chat Notify folder.
6. Confirm that Chat Notify appears in the extension list.

## Allow Notifications

1. Click the Chat Notify extension icon.
2. Click "Test notification".
3. If the browser or operating system asks for notification permission, allow it.
4. Confirm the test notification changes the popup notification status.
5. If no notification appears, check your browser and system notification settings.

## Test With A Supported Site

1. Open `https://chatgpt.com/`.
2. Or open the Gemini regular web app at `https://gemini.google.com/`.
3. Send a short prompt.
4. Switch to another tab or leave the supported-site tab open.
5. When the response completes, Chat Notify should show a browser/system notification.
6. Click the completion notification and confirm the source tab is focused.

## Recent Activity Diagnostics

The popup Recent activity area shows where the latest monitoring flow reached. These diagnostics are local and bounded. They may include a sanitized short prompt excerpt plus flow metadata, but they do not store full prompt contents, full chat content, assistant text, request or response bodies, tokens, or URLs.

If notifications do not appear, check Recent activity first. Then enable debug logs only if you need console details.

## Install From Source

Developers can clone the repository, run `npm test`, and load the repository folder with "Load unpacked" instead of using the release zip.

## Update To A New Alpha

1. Download the newer release zip.
2. Unzip it into a new folder.
3. Open `chrome://extensions` or `edge://extensions`.
4. Remove the older Chat Notify unpacked extension or click "Reload" after selecting the new folder.
5. Use "Test notification" again.
