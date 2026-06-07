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
