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
