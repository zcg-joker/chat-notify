# Install Chat Notify

This guide is for the Alpha version of Chat Notify. The extension is not yet available in the Chrome Web Store or Edge Add-ons, so it must be loaded manually.

## Install From A GitHub Release Zip

1. Open the Chat Notify GitHub Releases page.
2. Download the latest GitHub Release zip, for example `chat-notify-0.1.0-alpha.1.zip`.
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
4. If no notification appears, check your browser and system notification settings.

## Test With ChatGPT

1. Open `https://chatgpt.com/`.
2. Send a short prompt.
3. Switch to another tab or leave the ChatGPT tab open.
4. When the response completes, Chat Notify should show a browser/system notification.

## Install From Source

Developers can clone the repository, run `npm test`, and load the repository folder with "Load unpacked" instead of using the release zip.

## Update To A New Alpha

1. Download the newer release zip.
2. Unzip it into a new folder.
3. Open `chrome://extensions` or `edge://extensions`.
4. Remove the older Chat Notify unpacked extension or click "Reload" after selecting the new folder.
5. Use "Test notification" again.
