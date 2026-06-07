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
