# Notification Focus And Popup Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `0.2.0-alpha.1` with notification-click tab focusing and a clearer popup status panel.

**Architecture:** Keep the extension as a plain Manifest V3 extension. Add background service-worker helpers for status persistence and notification click targets, using `chrome.storage.local` for non-sensitive popup status and `chrome.storage.session` for notification click targets when available. Keep popup rendering simple and storage-free: it reads toggles from `storage.sync`, asks the background for operational status with `GET_POPUP_STATUS`, and updates status text after test notifications.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Node.js >=20, `node:test`, existing package script.

---

## File Structure

- Modify `manifest.json`: add `tabs` permission and bump manifest version to `0.2.0`.
- Modify `package.json`: bump package version to `0.2.0-alpha.1`.
- Modify `src/background/service-worker.js`: add popup status persistence, notification target persistence, notification click handling, and `GET_POPUP_STATUS`.
- Modify `src/popup/popup.html`: add compact status rows.
- Modify `src/popup/popup.js`: render background status and test notification result.
- Modify `src/popup/popup.css`: style status rows without turning the popup into a dashboard.
- Modify `tests/background.test.js`: cover status updates and notification click behavior.
- Modify `tests/popup.test.js`: cover status rendering and test notification UI updates.
- Modify `tests/manifest.test.js`: cover `tabs` permission.
- Modify `tests/package-metadata.test.js`: cover `0.2.0-alpha.1` package version and `0.2.0` manifest version.
- Modify `tests/package-script.test.js`: update expected zip artifact name to `chat-notify-0.2.0-alpha.1.zip`.
- Modify `README.md`, `README.zh-CN.md`, and `docs/RELEASE.md`: update release version and mention notification click behavior.

---

### Task 1: Version And Manifest Permission

**Files:**
- Modify: `package.json`
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/package-metadata.test.js`
- Modify: `tests/package-script.test.js`

- [ ] **Step 1: Write failing version and permission tests**

Update `tests/manifest.test.js` so the permission test expects `tabs`:

```js
assert.deepEqual(manifest.permissions.sort(), ["notifications", "storage", "tabs"].sort());
```

Update `tests/package-metadata.test.js`:

```js
assert.equal(packageJson.version, "0.2.0-alpha.1");
```

and:

```js
assert.equal(manifest.version, "0.2.0");
```

Update `tests/package-script.test.js` constants:

```js
const ZIP_PATH = path.join(DIST, "chat-notify-0.2.0-alpha.1.zip");
```

and any regex or artifact expectation from `0.1.0-alpha.1` to `0.2.0-alpha.1`.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- tests/manifest.test.js tests/package-metadata.test.js tests/package-script.test.js
```

Expected: FAIL because versions and permission are not updated yet.

- [ ] **Step 3: Implement version and permission changes**

In `package.json`, set:

```json
"version": "0.2.0-alpha.1"
```

In `manifest.json`, set:

```json
"version": "0.2.0"
```

and:

```json
"permissions": ["notifications", "storage", "tabs"]
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/manifest.test.js tests/package-metadata.test.js tests/package-script.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json manifest.json tests/manifest.test.js tests/package-metadata.test.js tests/package-script.test.js
git commit -m "chore: bump alpha version and tabs permission"
```

---

### Task 2: Background Status And Notification Click Targets

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `tests/background.test.js`

- [ ] **Step 1: Add failing background tests**

Add fake storage helpers inside `tests/background.test.js` or near the tests that need them:

```js
function createStorageArea(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    data,
    get(defaults, callback) {
      const result = Object.assign({}, defaults);
      for (const key of Object.keys(defaults || {})) {
        if (Object.hasOwn(data, key)) {
          result[key] = data[key];
        }
      }
      callback(result);
    },
    set(value, callback) {
      Object.assign(data, value);
      if (callback) callback();
    },
    remove(key, callback) {
      delete data[key];
      if (callback) callback();
    },
  };
}
```

Add tests for status and click behavior:

```js
test("completion notifications store a click target and update last completion status", async () => {
  const created = [];
  const local = createStorageArea();
  const session = createStorageArea();
  const service = createNotificationService({
    chromeApi: {
      storage: { local, session, sync: { get(defaults, callback) { callback(defaults); } } },
      runtime: { getURL: (path) => `chrome-extension://test/${path}` },
      notifications: {
        create(id, options, callback) {
          created.push({ id, options });
          callback(id);
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(createResponseCompletedMessage({
    siteId: "chatgpt",
    displayName: "ChatGPT",
    sessionKey: "conversation:a",
    sourceTabId: 42,
    promptExcerpt: "hello",
  }));

  assert.equal(result.ok, true);
  assert.equal(session.data.notificationTargets[result.notificationId].tabId, 42);
  assert.equal(session.data.notificationTargets[result.notificationId].notificationId, result.notificationId);
  assert.deepEqual(local.data.popupStatus.lastCompletion, {
    state: "sent",
    siteId: "chatgpt",
    updatedAt: 1780761600000,
  });
});

test("clicking a bound completion notification focuses window and activates tab", async () => {
  const local = createStorageArea();
  const session = createStorageArea({
    notificationTargets: {
      "notification-id": {
        notificationId: "notification-id",
        tabId: 42,
        windowId: 7,
        createdAt: 1780761600000,
      },
    },
  });
  const focusedWindows = [];
  const activatedTabs = [];
  const service = createNotificationService({
    chromeApi: {
      storage: { local, session, sync: { get(defaults, callback) { callback(defaults); } } },
      windows: {
        update(windowId, updateInfo, callback) {
          focusedWindows.push({ windowId, updateInfo });
          if (callback) callback({});
        },
      },
      tabs: {
        update(tabId, updateInfo, callback) {
          activatedTabs.push({ tabId, updateInfo });
          if (callback) callback({});
        },
      },
      notifications: { create() {} },
    },
  });

  const result = await service.handleNotificationClicked("notification-id");

  assert.deepEqual(result, { ok: true, focused: true });
  assert.deepEqual(focusedWindows, [{ windowId: 7, updateInfo: { focused: true } }]);
  assert.deepEqual(activatedTabs, [{ tabId: 42, updateInfo: { active: true } }]);
  assert.deepEqual(session.data.notificationTargets, {});
});

test("clicking an unknown notification does nothing", async () => {
  const service = createNotificationService({
    chromeApi: {
      storage: { session: createStorageArea(), local: createStorageArea() },
      windows: { update() { throw new Error("should not focus"); } },
      tabs: { update() { throw new Error("should not activate"); } },
      notifications: { create() {} },
    },
  });

  const result = await service.handleNotificationClicked("missing");

  assert.deepEqual(result, { ok: false, ignored: true });
});

test("test notification updates notification health but does not store click target", async () => {
  const local = createStorageArea();
  const session = createStorageArea();
  const service = createNotificationService({
    chromeApi: {
      storage: { local, session, sync: { get(defaults, callback) { callback(defaults); } } },
      runtime: { getURL: (path) => `chrome-extension://test/${path}` },
      notifications: {
        create(id, _options, callback) {
          callback(id);
        },
      },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage(createTestNotificationMessage());

  assert.equal(result.ok, true);
  assert.deepEqual(session.data.notificationTargets, undefined);
  assert.deepEqual(local.data.popupStatus.notificationHealth, {
    state: "working",
    message: "",
    updatedAt: 1780761600000,
  });
});

test("GET_POPUP_STATUS returns default status when no status is stored", async () => {
  const service = createNotificationService({
    chromeApi: {
      storage: { local: createStorageArea(), sync: { get(defaults, callback) { callback(defaults); } } },
      notifications: { create() {} },
    },
    now: () => 1780761600000,
  });

  const result = await service.handleMessage({ type: "GET_POPUP_STATUS" });

  assert.deepEqual(result, {
    ok: true,
    status: {
      notificationHealth: { state: "not_tested", message: "", updatedAt: null },
      lastCompletion: { state: "none", siteId: "", updatedAt: null },
    },
  });
});
```

- [ ] **Step 2: Run background tests and verify they fail**

Run:

```bash
npm test -- tests/background.test.js
```

Expected: FAIL because `handleNotificationClicked`, `GET_POPUP_STATUS`, target storage, and popup status persistence do not exist yet.

- [ ] **Step 3: Implement storage helpers and status defaults**

In `src/background/service-worker.js`, inside `createNotificationService`, add helpers:

```js
const POPUP_STATUS_KEY = "popupStatus";
const NOTIFICATION_TARGETS_KEY = "notificationTargets";
const DEFAULT_POPUP_STATUS = Object.freeze({
  notificationHealth: { state: "not_tested", message: "", updatedAt: null },
  lastCompletion: { state: "none", siteId: "", updatedAt: null },
});
```

Add promise wrappers for `storage.local`, `storage.session`, `tabs.update`, and `windows.update`. Use storage fallback behavior:

- `storage.local` missing: return defaults and ignore writes.
- `storage.session` missing: use an in-memory object inside `createNotificationService`.
- `runtime.lastError`: resolve best-effort failures instead of throwing.

Add helpers with these exact responsibilities:

- `getPopupStatus()`: read `popupStatus` from `chrome.storage.local`, merge it over `DEFAULT_POPUP_STATUS`, and return a status object with `notificationHealth` and `lastCompletion`.
- `setPopupStatusPatch(patch)`: read current popup status, shallow-merge the provided top-level fields, and write the result to `chrome.storage.local` under `popupStatus`.
- `saveNotificationTarget(notificationId, target)`: read the current `notificationTargets` object, store a sanitized target at `notificationTargets[notificationId]`, and write it to `chrome.storage.session` or the in-memory fallback.
- `getNotificationTarget(notificationId)`: read `notificationTargets` and return the matching target or `null`.
- `clearNotificationTarget(notificationId)`: remove one key from `notificationTargets` and write the updated object.
- `focusNotificationTarget(target)`: focus `target.windowId` when it is finite, activate `target.tabId`, return `{ ok: true, focused: true }` on success, and return `{ ok: false, focused: false }` without throwing on Chrome API errors.

The stored target must contain only `notificationId`, `tabId`, `windowId`, and `createdAt`.

- [ ] **Step 4: Wire status into message handling**

In `handleMessage`:

- For `GET_POPUP_STATUS`, return `{ ok: true, status: await getPopupStatus() }`.
- On test notification success, set `notificationHealth` to `{ state: "working", message: "", updatedAt: now() }`.
- On test notification failure, set `notificationHealth` to `{ state: "failed", message: notificationResult.error || "", updatedAt: now() }`.
- On completion notification success, set `lastCompletion` to `{ state: "sent", siteId: payload.siteId || "", updatedAt: now() }`.
- On completion notification failure, set `lastCompletion` to `{ state: "failed", siteId: payload.siteId || "", updatedAt: now() }`.
- On completion notification success with a finite `sourceTabId`, save notification target.

Derive `windowId` from `sender.tab.windowId` only when `sender.tab.id === sourceTabId` and `sender.tab.windowId` is finite. If no `windowId` is available, store only `tabId`; click handling should still activate the tab.

- [ ] **Step 5: Wire notification click listener**

Return `handleNotificationClicked` from `createNotificationService`.

In the real extension bootstrap, add:

```js
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    service.handleNotificationClicked(notificationId);
  });
}
```

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/background.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/background/service-worker.js tests/background.test.js
git commit -m "feat: focus source tab from notifications"
```

---

### Task 3: Popup Status UI

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.js`
- Modify: `src/popup/popup.css`
- Modify: `tests/popup.test.js`

- [ ] **Step 1: Add failing popup tests**

Update `tests/popup.test.js` fake elements so elements can capture `disabled` and class names if needed:

```js
className: "",
disabled: false,
```

Add elements:

```js
"extension-status": createElement("extension-status"),
"notification-status": createElement("notification-status"),
"completion-status": createElement("completion-status"),
"notification-detail": createElement("notification-detail"),
```

Update `runPopup` fake `chrome.runtime.sendMessage` to call callbacks:

```js
sendMessage(message, callback) {
  runtimeMessages.push(message);
  if (message.type === "GET_POPUP_STATUS" && callback) {
    callback(statusResponse);
    return;
  }
  if (message.type === "TEST_NOTIFICATION" && callback) {
    callback(testNotificationResponse);
  }
}
```

Add parameters:

```js
statusResponse = {
  ok: true,
  status: {
    notificationHealth: { state: "not_tested", message: "", updatedAt: null },
    lastCompletion: { state: "none", siteId: "", updatedAt: null },
  },
},
testNotificationResponse = { ok: true, notificationId: "test-id" },
```

Add tests:

```js
test("popup renders background status summaries", () => {
  const popup = runPopup({
    enabled: true,
    statusResponse: {
      ok: true,
      status: {
        notificationHealth: { state: "working", message: "", updatedAt: 1780761600000 },
        lastCompletion: { state: "sent", siteId: "chatgpt", updatedAt: 1780761600000 },
      },
    },
  });

  assert.equal(popup.elements["extension-status"].textContent, "Enabled");
  assert.equal(popup.elements["notification-status"].textContent, "Notifications working");
  assert.equal(popup.elements["completion-status"].textContent, "Last notification sent");
});

test("popup shows test notification failure response", () => {
  const popup = runPopup({
    testNotificationResponse: {
      ok: false,
      error: "notifications permission missing",
      notificationId: "test-id",
    },
  });

  popup.elements["test-notification"].dispatch("click");

  assert.equal(popup.elements["notification-status"].textContent, "Notification failed");
  assert.equal(popup.elements["notification-detail"].textContent, "notifications permission missing");
});
```

- [ ] **Step 2: Run popup tests and verify they fail**

Run:

```bash
npm test -- tests/popup.test.js
```

Expected: FAIL because the new status elements and background status calls do not exist.

- [ ] **Step 3: Update popup HTML**

In `src/popup/popup.html`, add a compact status section after the header:

```html
<section class="status-list" aria-label="Extension status">
  <div class="status-row">
    <span>Page</span>
    <strong id="site-status">Checking page...</strong>
  </div>
  <div class="status-row">
    <span>Extension</span>
    <strong id="extension-status">Checking...</strong>
  </div>
  <div class="status-row">
    <span>Notifications</span>
    <strong id="notification-status">Not tested yet</strong>
  </div>
  <p id="notification-detail" class="status-detail"></p>
  <div class="status-row">
    <span>Last completion</span>
    <strong id="completion-status">No completions yet</strong>
  </div>
</section>
```

Remove the old `site-status` paragraph from the header so the ID is unique.

- [ ] **Step 4: Update popup JS**

In `src/popup/popup.js`:

- Read new DOM elements.
- Render extension status from `enabled`.
- Send `{ type: ChatNotify.MESSAGE_TYPES.GET_POPUP_STATUS }` on load.
- Render status states with functions:

```js
function getNotificationText(state) {
  if (state === "working") return "Notifications working";
  if (state === "failed") return "Notification failed";
  return "Not tested yet";
}

function getCompletionText(state) {
  if (state === "sent") return "Last notification sent";
  if (state === "failed") return "Last notification failed";
  return "No completions yet";
}
```

- On `Test notification` click, pass a callback to `chrome.runtime.sendMessage`; update notification status from response.
- Handle `chrome.runtime.lastError` by rendering `Notification failed` and the error message.

- [ ] **Step 5: Update popup CSS**

In `src/popup/popup.css`, add restrained status styling:

```css
.status-list {
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.status-row strong {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.status-detail {
  min-height: 0;
  color: #6b7280;
}
```

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/popup.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/popup/popup.html src/popup/popup.js src/popup/popup.css tests/popup.test.js
git commit -m "feat: show notification status in popup"
```

---

### Task 4: Docs, Package Metadata, And Release Prep

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/RELEASE.md`
- Modify: `tests/package-metadata.test.js`
- Modify: `tests/package-script.test.js`

- [ ] **Step 1: Add failing docs/version assertions**

Update `tests/package-metadata.test.js` to assert README mentions notification click behavior and popup status:

```js
assert.match(readme, /Click a completion notification/i);
assert.match(readme, /popup status/i);
```

Update Chinese README test:

```js
assert.match(readme, /点击通知/);
assert.match(readme, /状态/);
```

Update release guide tests and package script tests from `0.1.0-alpha.1` to `0.2.0-alpha.1`.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- tests/package-metadata.test.js tests/package-script.test.js
```

Expected: FAIL because docs still mention `0.1.0-alpha.1` and do not describe the new behavior.

- [ ] **Step 3: Update docs**

Update README files to mention:

- Clicking a completion notification returns to the source tab.
- Popup shows page, extension, notification health, and last completion status.
- Release zip name is `chat-notify-0.2.0-alpha.1.zip`.

Update `docs/INSTALL.md` manual validation:

- Test notification changes popup notification status.
- Completion notification click focuses the ChatGPT tab.

Update `docs/TROUBLESHOOTING.md`:

- If notification click does not focus the tab, check whether the source tab/window was closed.
- Debug logs can help diagnose notification click failures.

Update `docs/RELEASE.md`:

- Version `0.2.0-alpha.1`.
- Artifact `dist/chat-notify-0.2.0-alpha.1.zip`.
- Release notes include notification click focus and popup status.

- [ ] **Step 4: Verify docs and packaging tests**

Run:

```bash
npm test -- tests/package-metadata.test.js tests/package-script.test.js
npm test
npm run package
```

Expected: all tests PASS and package command creates `dist/chat-notify-0.2.0-alpha.1.zip`.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md README.zh-CN.md docs/INSTALL.md docs/TROUBLESHOOTING.md docs/RELEASE.md tests/package-metadata.test.js tests/package-script.test.js
git commit -m "docs: prepare v0.2 alpha release notes"
```

---

### Task 5: Final Verification

**Files:**
- Modify only if verification finds a concrete issue.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Rebuild package**

Run:

```bash
npm run package
```

Expected:

```text
Created dist/chat-notify-0.2.0-alpha.1.zip
```

- [ ] **Step 3: Inspect package contents**

Run:

```bash
unzip -Z1 dist/chat-notify-0.2.0-alpha.1.zip | sort
unzip -Z1 dist/chat-notify-0.2.0-alpha.1.zip | rg '^(tests/|docs/|node_modules/|\.git/|coverage/)|\.DS_Store' || true
```

Expected:

- Includes `manifest.json`, `LICENSE`, `src/`, and `assets/`.
- Exclusion command prints no output.

- [ ] **Step 4: Manual validation checklist**

Before release, manually verify in Chrome or Edge:

- Load unpacked extension from the packaged zip.
- Open popup and confirm page/extension/notification/last completion statuses render.
- Click `Test notification` and confirm popup notification status updates.
- Send a ChatGPT prompt, wait for completion notification, click it, and confirm the source ChatGPT tab becomes active.
- Close source tab before clicking a notification and confirm no user-visible error.

- [ ] **Step 5: Commit fixes if needed**

If verification required changes, inspect the changed files with `git status --short` and commit only those concrete files:

```bash
git add path/to/changed-file
git commit -m "chore: finalize v0.2 alpha verification"
```

If no changes were needed, do not create an empty commit.
