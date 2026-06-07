const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("manifest uses MV3 and minimal permissions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["notifications", "storage", "tabs"].sort());
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
  ]);
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
});

test("manifest declares content scripts in dependency order", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );
  const scripts = manifest.content_scripts[0].js;

  assert.deepEqual(scripts, [
    "src/shared/constants.js",
    "src/shared/messages.js",
    "src/core/prompt-excerpt.js",
    "src/core/state-machine.js",
    "src/core/session-tracker.js",
    "src/core/dom-watch.js",
    "src/adapters/adapter-contract.js",
    "src/adapters/chatgpt-adapter.js",
    "src/core/monitor-controller.js",
    "src/content/content-script.js",
  ]);
});

test("manifest icons use supported PNG files", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );

  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);

  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(path.extname(iconPath), ".png");
    assert.equal(fs.existsSync(path.join(__dirname, "..", iconPath)), true);
  }
});
