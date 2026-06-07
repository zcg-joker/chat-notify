# Chat Notify Alpha Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Chat Notify as a GitHub-ready Alpha open-source browser extension with MIT licensing, user/developer documentation, and a clean release zip workflow.

**Architecture:** Keep the extension as a plain Manifest V3 project with no build step. Add documentation at the repository root and under `docs/`, and add a small Node packaging script that copies only runtime extension files into `dist/extension/` and produces a zip in `dist/`. Keep tests focused on package metadata, documentation presence, and artifact contents.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Node.js >=20, `node:test`, shell `zip` command invoked from a Node script.

---

## File Structure

- Modify `package.json`: set Alpha package version, keep MIT license, and add `package` script.
- Keep `manifest.json` version at `0.1.0`: Chrome extension manifests do not accept prerelease semver strings like `0.1.0-alpha.1`.
- Create `LICENSE`: MIT License text.
- Rewrite `README.md`: GitHub project landing page for developers and early users.
- Create `docs/INSTALL.md`: ordinary-user install guide for Release zip and source checkout fallback.
- Create `docs/TROUBLESHOOTING.md`: notification/debug/logging guide.
- Create `docs/RELEASE.md`: maintainer release procedure.
- Create `scripts/package-extension.js`: local packaging script.
- Create `tests/package-metadata.test.js`: license/version/documentation checks.
- Create `tests/package-script.test.js`: packaging artifact tests.

---

### Task 1: Alpha Metadata And MIT License

**Files:**
- Modify: `package.json`
- Create: `LICENSE`
- Create: `tests/package-metadata.test.js`

- [ ] **Step 1: Write failing metadata tests**

Create `tests/package-metadata.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("package metadata uses alpha version and MIT license", () => {
  const packageJson = readJson("package.json");

  assert.equal(packageJson.name, "chat-notify");
  assert.equal(packageJson.version, "0.1.0-alpha.1");
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.scripts.test, "node --test");
  assert.equal(packageJson.scripts.package, "node scripts/package-extension.js");
});

test("manifest keeps Chrome-compatible release version", () => {
  const manifest = readJson("manifest.json");

  assert.equal(manifest.version, "0.1.0");
  assert.match(manifest.description, /ChatGPT/);
});

test("repository includes MIT license text", () => {
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");

  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
});
```

- [ ] **Step 2: Run metadata tests and verify they fail**

Run:

```bash
npm test -- tests/package-metadata.test.js
```

Expected: FAIL because `package.json` still uses `0.1.0`, `private` is currently `true`, the `package` script does not exist, and `LICENSE` does not exist.

- [ ] **Step 3: Update package metadata**

Edit `package.json` to:

```json
{
  "name": "chat-notify",
  "version": "0.1.0-alpha.1",
  "private": false,
  "description": "A privacy-conscious browser extension that notifies when AI chat responses complete.",
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test tests/*.test.js",
    "package": "node scripts/package-extension.js"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

- [ ] **Step 4: Add MIT license**

Create `LICENSE` with:

```text
MIT License

Copyright (c) 2026 Chat Notify contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Run metadata tests and full tests**

Run:

```bash
npm test -- tests/package-metadata.test.js
npm test
```

Expected: both PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json LICENSE tests/package-metadata.test.js
git commit -m "chore: add alpha metadata and license"
```

---

### Task 2: GitHub-Ready Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/INSTALL.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/RELEASE.md`
- Modify: `tests/package-metadata.test.js`

- [ ] **Step 1: Add failing documentation coverage tests**

Append these tests to `tests/package-metadata.test.js`:

```js
test("README presents alpha release information and links to docs", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(readme, /^# Chat Notify/m);
  assert.match(readme, /Alpha/i);
  assert.match(readme, /GitHub Releases/i);
  assert.match(readme, /ChatGPT only/i);
  assert.match(readme, /privacy-conscious/i);
  assert.match(readme, /\[Install guide\]\(docs\/INSTALL\.md\)/);
  assert.match(readme, /\[Troubleshooting\]\(docs\/TROUBLESHOOTING\.md\)/);
  assert.match(readme, /\[Release guide\]\(docs\/RELEASE\.md\)/);
});

test("install guide covers release zip and browser loading steps", () => {
  const installGuide = fs.readFileSync(path.join(ROOT, "docs/INSTALL.md"), "utf8");

  assert.match(installGuide, /^# Install Chat Notify/m);
  assert.match(installGuide, /GitHub Release zip/i);
  assert.match(installGuide, /chrome:\/\/extensions/);
  assert.match(installGuide, /edge:\/\/extensions/);
  assert.match(installGuide, /Load unpacked/i);
  assert.match(installGuide, /Test notification/i);
  assert.match(installGuide, /Update/i);
});

test("troubleshooting guide covers notification and debug diagnostics", () => {
  const troubleshooting = fs.readFileSync(path.join(ROOT, "docs/TROUBLESHOOTING.md"), "utf8");

  assert.match(troubleshooting, /^# Troubleshooting/m);
  assert.match(troubleshooting, /Test notification does not appear/i);
  assert.match(troubleshooting, /ChatGPT response completion notification does not appear/i);
  assert.match(troubleshooting, /Prompt excerpt looks wrong/i);
  assert.match(troubleshooting, /Debug logs/i);
  assert.match(troubleshooting, /service worker/i);
  assert.match(troubleshooting, /Do not paste full chat content/i);
});

test("release guide covers maintainer package and GitHub release flow", () => {
  const releaseGuide = fs.readFileSync(path.join(ROOT, "docs/RELEASE.md"), "utf8");

  assert.match(releaseGuide, /^# Release Guide/m);
  assert.match(releaseGuide, /0\.1\.0-alpha\.1/);
  assert.match(releaseGuide, /npm test/);
  assert.match(releaseGuide, /npm run package/);
  assert.match(releaseGuide, /Inspect the zip/i);
  assert.match(releaseGuide, /GitHub Release/i);
  assert.match(releaseGuide, /chat-notify-0\.1\.0-alpha\.1\.zip/);
});
```

- [ ] **Step 2: Run documentation tests and verify they fail**

Run:

```bash
npm test -- tests/package-metadata.test.js
```

Expected: FAIL because the new docs do not exist and current README does not contain Alpha release guidance.

- [ ] **Step 3: Rewrite README**

Replace `README.md` with:

```md
# Chat Notify

Chat Notify is a privacy-conscious browser extension that sends a browser/system notification when ChatGPT finishes responding.

> Alpha status: this project is ready for early GitHub testing, but it is not yet published on the Chrome Web Store or Edge Add-ons.

## What It Does

- Starts monitoring only after you send a ChatGPT message.
- Supports multiple active ChatGPT sessions.
- Supports multiple tabs and same-tab conversation switching when the response lifecycle remains observable.
- Sends a browser/system notification when an observable response completes.
- Shows a short excerpt of your prompt in the notification.
- Keeps debug logs off by default.

The Alpha supports ChatGPT only:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## Install

Recommended for early users: download the latest GitHub Release zip and follow the [Install guide](docs/INSTALL.md).

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
- No click-to-focus notification behavior yet.

## Open Source

Chat Notify is released under the MIT License. Issues and early feedback are welcome once the repository is published on GitHub.
```

- [ ] **Step 4: Create install guide**

Create `docs/INSTALL.md` with:

```md
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
```

- [ ] **Step 5: Create troubleshooting guide**

Create `docs/TROUBLESHOOTING.md` with:

```md
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
```

- [ ] **Step 6: Create release guide**

Create `docs/RELEASE.md` with:

````md
# Release Guide

This guide is for maintainers preparing a GitHub Alpha release.

## Version

The first Alpha release is `0.1.0-alpha.1`.

`package.json` uses the Alpha version for npm scripts and zip naming. `manifest.json` uses `0.1.0` because Chrome extension manifests require a numeric dotted version and do not accept prerelease strings.

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
dist/chat-notify-0.1.0-alpha.1.zip
```

## Inspect The Zip

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
5. Send a short ChatGPT prompt and confirm a completion notification appears.

## Create GitHub Release

1. Create a tag named `v0.1.0-alpha.1`.
2. Create a GitHub Release from the tag.
3. Attach `chat-notify-0.1.0-alpha.1.zip`.
4. Mention that this is a manual-install Alpha.
5. Link to `docs/INSTALL.md` and `docs/TROUBLESHOOTING.md`.

## Alpha Release Notes Template

```text
Chat Notify 0.1.0-alpha.1

This Alpha supports ChatGPT response completion notifications for Chrome and Edge Chromium.

Install:
- Download chat-notify-0.1.0-alpha.1.zip.
- Unzip it.
- Load the unzipped folder from chrome://extensions or edge://extensions with Developer mode enabled.

Known limits:
- ChatGPT only.
- Manual installation only.
- No Chrome Web Store listing yet.
```
````

- [ ] **Step 7: Run documentation tests and full tests**

Run:

```bash
npm test -- tests/package-metadata.test.js
npm test
```

Expected: both PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add README.md docs/INSTALL.md docs/TROUBLESHOOTING.md docs/RELEASE.md tests/package-metadata.test.js
git commit -m "docs: prepare alpha release documentation"
```

---

### Task 3: Packaging Script

**Files:**
- Create: `scripts/package-extension.js`
- Create: `tests/package-script.test.js`

- [ ] **Step 1: Write failing package script tests**

Create `tests/package-script.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const ZIP_PATH = path.join(DIST, "chat-notify-0.1.0-alpha.1.zip");
const EXTENSION_DIR = path.join(DIST, "extension");

function listZipEntries(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim().split(/\n/).filter(Boolean).sort();
}

test("package script creates clean extension directory and zip", () => {
  fs.rmSync(DIST, { recursive: true, force: true });

  const result = spawnSync("npm", ["run", "package"], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /chat-notify-0\.1\.0-alpha\.1\.zip/);
  assert.equal(fs.existsSync(ZIP_PATH), true);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "manifest.json")), true);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "src/content/content-script.js")), true);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "assets/icon-128.png")), true);
  assert.equal(fs.existsSync(path.join(EXTENSION_DIR, "LICENSE")), true);
});

test("package zip contains runtime files and excludes development files", () => {
  if (!fs.existsSync(ZIP_PATH)) {
    const result = spawnSync("npm", ["run", "package"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const entries = listZipEntries(ZIP_PATH);

  assert.ok(entries.includes("manifest.json"));
  assert.ok(entries.includes("src/content/content-script.js"));
  assert.ok(entries.includes("src/content/page-lifecycle-bridge.js"));
  assert.ok(entries.includes("src/background/service-worker.js"));
  assert.ok(entries.includes("src/popup/popup.html"));
  assert.ok(entries.includes("assets/icon-128.png"));
  assert.ok(entries.includes("LICENSE"));

  assert.equal(entries.some((entry) => entry.startsWith("tests/")), false);
  assert.equal(entries.some((entry) => entry.startsWith("docs/")), false);
  assert.equal(entries.some((entry) => entry.startsWith("node_modules/")), false);
  assert.equal(entries.some((entry) => entry.startsWith(".git/")), false);
  assert.equal(entries.some((entry) => entry.includes(".DS_Store")), false);
});
```

- [ ] **Step 2: Run package script tests and verify they fail**

Run:

```bash
npm test -- tests/package-script.test.js
```

Expected: FAIL because `scripts/package-extension.js` does not exist and `npm run package` cannot complete.

- [ ] **Step 3: Add packaging script**

Create `scripts/package-extension.js` with:

```js
#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EXTENSION_DIR = path.join(DIST, "extension");
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const artifactName = `${packageJson.name}-${packageJson.version}.zip`;
const artifactPath = path.join(DIST, artifactName);

const runtimePaths = [
  "manifest.json",
  "src",
  "assets",
  "LICENSE",
];

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (entry === ".DS_Store") {
        continue;
      }
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function assertZipAvailable() {
  const result = spawnSync("zip", ["-v"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("The zip command is required to package the extension.");
  }
}

function createZip() {
  const result = spawnSync("zip", ["-qr", artifactPath, "."], {
    cwd: EXTENSION_DIR,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to create extension zip.");
  }
}

function main() {
  assertZipAvailable();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(EXTENSION_DIR, { recursive: true });

  for (const runtimePath of runtimePaths) {
    copyRecursive(path.join(ROOT, runtimePath), path.join(EXTENSION_DIR, runtimePath));
  }

  createZip();
  console.log(`Created ${path.relative(ROOT, artifactPath)}`);
}

main();
```

- [ ] **Step 4: Run package script tests**

Run:

```bash
npm test -- tests/package-script.test.js
```

Expected: PASS and `dist/chat-notify-0.1.0-alpha.1.zip` exists.

- [ ] **Step 5: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json scripts/package-extension.js tests/package-script.test.js
git commit -m "chore: add alpha package script"
```

---

### Task 4: Package Artifact Validation And Release Documentation Alignment

**Files:**
- Modify: `docs/RELEASE.md`
- Modify: `README.md`
- Modify: `tests/package-script.test.js`

- [ ] **Step 1: Add a manifest-in-package validation test**

Append this test to `tests/package-script.test.js`:

```js
test("packaged manifest is valid and references files included in the artifact", () => {
  if (!fs.existsSync(ZIP_PATH)) {
    const result = spawnSync("npm", ["run", "package"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8")
  );
  const entries = new Set(listZipEntries(ZIP_PATH));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(entries.has(manifest.background.service_worker), true);
  assert.equal(entries.has(manifest.action.default_popup), true);

  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(entries.has(iconPath), true);
  }

  for (const scriptPath of manifest.content_scripts[0].js) {
    assert.equal(entries.has(scriptPath), true);
  }

  for (const resource of manifest.web_accessible_resources[0].resources) {
    assert.equal(entries.has(resource), true);
  }
});
```

- [ ] **Step 2: Run package tests**

Run:

```bash
npm test -- tests/package-script.test.js
```

Expected: PASS if Task 3 package contents are correct. If it fails, fix `scripts/package-extension.js` so every manifest reference is included in the zip.

- [ ] **Step 3: Tighten release docs with exact artifact inspection command**

In `docs/RELEASE.md`, add this command under "Inspect The Zip":

```md
```bash
unzip -Z1 dist/chat-notify-0.1.0-alpha.1.zip
```
```

Also add:

```md
The output should list paths without a leading `dist/extension/` prefix. `manifest.json` should be at the zip root.
```

- [ ] **Step 4: Tighten README package wording**

In `README.md`, ensure the release zip section includes:

```md
The generated zip has `manifest.json` at the archive root so the unzipped folder can be selected directly with "Load unpacked".
```

- [ ] **Step 5: Run tests and package command**

Run:

```bash
npm test -- tests/package-script.test.js
npm test
npm run package
unzip -Z1 dist/chat-notify-0.1.0-alpha.1.zip | sed -n '1,80p'
```

Expected:

- Tests PASS.
- `npm run package` prints `Created dist/chat-notify-0.1.0-alpha.1.zip`.
- `unzip -Z1` shows `manifest.json`, `src/...`, `assets/...`, and `LICENSE` at the zip root.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md docs/RELEASE.md tests/package-script.test.js
git commit -m "test: validate alpha package artifact"
```

---

### Task 5: Final Alpha Readiness Verification

**Files:**
- Modify only if verification finds a concrete issue.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Rebuild release artifact**

Run:

```bash
npm run package
```

Expected:

```text
Created dist/chat-notify-0.1.0-alpha.1.zip
```

- [ ] **Step 3: Inspect package contents**

Run:

```bash
unzip -Z1 dist/chat-notify-0.1.0-alpha.1.zip | sort
```

Expected:

- Includes `manifest.json`.
- Includes `LICENSE`.
- Includes files under `src/`.
- Includes files under `assets/`.
- Does not include `tests/`, `docs/`, `node_modules/`, `.git/`, `coverage/`, or `.DS_Store`.

- [ ] **Step 4: Confirm worktree state**

Run:

```bash
git status --short
```

Expected: clean except for ignored `dist/` output.

- [ ] **Step 5: Commit any verification fixes**

If Step 1-4 required file changes, commit them:

```bash
git add <changed-files>
git commit -m "chore: finalize alpha readiness"
```

If no changes were needed, do not create an empty commit.

- [ ] **Step 6: Report completion**

Report:

- Final commit hash.
- `npm test` result.
- Package artifact path.
- Any manual browser validation still recommended before pushing the GitHub Release.
