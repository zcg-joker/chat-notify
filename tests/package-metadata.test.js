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
  assert.equal(packageJson.version, "0.2.0-alpha.1");
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.scripts.test, "node --test");
  assert.equal(packageJson.scripts.package, "node scripts/package-extension.js");
});

test("manifest keeps Chrome-compatible release version", () => {
  const manifest = readJson("manifest.json");

  assert.equal(manifest.version, "0.2.0");
  assert.match(manifest.description, /ChatGPT/);
});

test("repository includes MIT license text", () => {
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");

  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test("README presents alpha release information and links to docs", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(readme, /^# Chat Notify/m);
  assert.match(readme, /\[中文说明\]\(README\.zh-CN\.md\)/);
  assert.match(readme, /Alpha/i);
  assert.match(readme, /GitHub Releases/i);
  assert.match(readme, /ChatGPT/i);
  assert.match(readme, /Gemini/i);
  assert.match(readme, /privacy-conscious/i);
  assert.match(readme, /Click a completion notification/i);
  assert.match(readme, /popup status/i);
  assert.match(readme, /\[Install guide\]\(docs\/INSTALL\.md\)/);
  assert.match(readme, /\[Troubleshooting\]\(docs\/TROUBLESHOOTING\.md\)/);
  assert.match(readme, /\[Release guide\]\(docs\/RELEASE\.md\)/);
});

test("README mentions Gemini and diagnostics", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(readme, /Gemini/);
  assert.match(readme, /recent activity|diagnostics/i);
});

test("README explains diagnostics privacy boundaries", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(readme, /diagnostics.+local.+bounded/is);
  assert.match(readme, /sanitized short prompt excerpt/i);
  assert.match(readme, /flow metadata/i);
  assert.match(readme, /do not store full prompt/i);
  assert.match(readme, /full chat content/i);
});

test("Chinese README links back to English README and covers alpha basics", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.zh-CN.md"), "utf8");

  assert.match(readme, /^# Chat Notify/m);
  assert.match(readme, /\[English README\]\(README\.md\)/);
  assert.match(readme, /Alpha/);
  assert.match(readme, /ChatGPT/);
  assert.match(readme, /GitHub Releases/);
  assert.match(readme, /隐私/);
  assert.match(readme, /点击通知/);
  assert.match(readme, /状态/);
  assert.match(readme, /MIT License/);
});

test("Chinese README mentions Gemini and recent activity diagnostics", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.zh-CN.md"), "utf8");

  assert.match(readme, /Gemini/);
  assert.match(readme, /最近活动|诊断/);
});

test("Chinese README explains diagnostics privacy boundaries", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.zh-CN.md"), "utf8");

  assert.match(readme, /诊断.+本地.+有限/s);
  assert.match(readme, /清理后的简短问题摘要/);
  assert.match(readme, /流程元数据/);
  assert.match(readme, /不保存完整问题/);
  assert.match(readme, /完整聊天内容/);
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

test("install guide explains diagnostics privacy boundaries", () => {
  const installGuide = fs.readFileSync(path.join(ROOT, "docs/INSTALL.md"), "utf8");

  assert.match(installGuide, /diagnostics.+local.+bounded/is);
  assert.match(installGuide, /sanitized short prompt excerpt/i);
  assert.match(installGuide, /do not store full prompt/i);
  assert.match(installGuide, /full chat content/i);
});

test("troubleshooting guide covers notification and debug diagnostics", () => {
  const troubleshooting = fs.readFileSync(path.join(ROOT, "docs/TROUBLESHOOTING.md"), "utf8");

  assert.match(troubleshooting, /^# Troubleshooting/m);
  assert.match(troubleshooting, /Test notification does not appear/i);
  assert.match(troubleshooting, /ChatGPT or Gemini response completion notification does not appear/i);
  assert.match(troubleshooting, /Prompt excerpt looks wrong/i);
  assert.match(troubleshooting, /Debug logs/i);
  assert.match(troubleshooting, /service worker/i);
  assert.match(troubleshooting, /Do not paste full chat content/i);
});

test("troubleshooting guide covers recent activity diagnostics", () => {
  const guide = fs.readFileSync(path.join(ROOT, "docs", "TROUBLESHOOTING.md"), "utf8");

  assert.match(guide, /Recent activity|最近活动|diagnostics/i);
});

test("troubleshooting guide explains diagnostics privacy boundaries", () => {
  const guide = fs.readFileSync(path.join(ROOT, "docs", "TROUBLESHOOTING.md"), "utf8");

  assert.match(guide, /diagnostics.+local.+bounded/is);
  assert.match(guide, /sanitized short prompt excerpt/i);
  assert.match(guide, /flow metadata/i);
  assert.match(guide, /do not store full prompt/i);
  assert.match(guide, /request or response bodies/i);
});

test("release guide covers maintainer package and GitHub release flow", () => {
  const releaseGuide = fs.readFileSync(path.join(ROOT, "docs/RELEASE.md"), "utf8");

  assert.match(releaseGuide, /^# Release Guide/m);
  assert.match(releaseGuide, /0\.2\.0-alpha\.1/);
  assert.match(releaseGuide, /npm test/);
  assert.match(releaseGuide, /npm run package/);
  assert.match(releaseGuide, /Inspect the zip/i);
  assert.match(releaseGuide, /GitHub Release/i);
  assert.match(releaseGuide, /chat-notify-0\.2\.0-alpha\.1\.zip/);
});
