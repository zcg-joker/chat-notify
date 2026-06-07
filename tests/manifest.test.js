const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );
}

test("manifest uses MV3 and minimal permissions", () => {
  const manifest = readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "notifications", "scripting", "storage", "tabs"].sort());
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
  ]);
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
});

test("manifest declares content scripts in dependency order", () => {
  const manifest = readManifest();
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
    "src/adapters/gemini-adapter.js",
    "src/content/page-probe-adapter.js",
    "src/core/monitor-controller.js",
    "src/content/content-script.js",
  ]);
});

test("manifest keeps packaged content scripts reusable for page probe injection", () => {
  const manifest = readManifest();
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.includes("src/content/content-script.js"));
  assert.ok(scripts.includes("src/content/page-probe-adapter.js"));
  assert.ok(scripts.indexOf("src/content/page-probe-adapter.js") < scripts.indexOf("src/content/content-script.js"));
});

test("manifest supports Gemini content script loading", () => {
  const manifest = readManifest();
  const scripts = manifest.content_scripts[0];

  assert.ok(scripts.matches.includes("https://gemini.google.com/*"));
  assert.ok(scripts.js.includes("src/adapters/gemini-adapter.js"));
  assert.ok(
    scripts.js.indexOf("src/adapters/gemini-adapter.js") <
      scripts.js.indexOf("src/content/content-script.js")
  );
});

test("manifest exposes lifecycle bridge resources on Gemini pages", () => {
  const manifest = readManifest();
  const resources = manifest.web_accessible_resources[0];

  assert.ok(resources.resources.includes("src/content/page-lifecycle-bridge.js"));
  assert.ok(resources.matches.includes("https://gemini.google.com/*"));
});

test("manifest icons use supported PNG files", () => {
  const manifest = readManifest();

  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);

  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(path.extname(iconPath), ".png");
    assert.equal(fs.existsSync(path.join(__dirname, "..", iconPath)), true);
  }
});
