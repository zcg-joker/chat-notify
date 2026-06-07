# Chat Notify Alpha Release Design

Date: 2026-06-07

## Product Goal

The Alpha release turns the current ChatGPT MVP into a GitHub-ready open-source project that both developers and non-technical early users can install, test, and give feedback on.

This is not a Chrome Web Store release. It is a public Alpha package for GitHub: clear source, clear license, clear installation instructions, a clean release zip, and honest documentation about current limits.

## Target Users

The Alpha supports two audiences:

- Developers and early technical testers who can clone the repository, run tests, inspect source code, load the unpacked extension, and use debug logs.
- Non-technical early users who can download a GitHub Release zip, unzip it, load it in Chrome or Edge, allow notifications, and use the test notification button.

The documentation should avoid assuming that every user knows Chrome extension development. Developer details belong in `README.md` and release docs; ordinary installation steps belong in a dedicated install guide.

## Alpha Scope

The Alpha includes:

- Existing ChatGPT-only notification behavior.
- Existing popup controls: enabled toggle, debug logs toggle, supported-page status, and test notification button.
- MIT license.
- GitHub-ready README.
- Plain-language install guide for Chrome and Edge.
- Troubleshooting guide for notification permission, missing notifications, stale extension builds, and debug logs.
- Maintainer release guide.
- Local package script that creates a clean extension zip for GitHub Releases.
- Version naming convention beginning with `0.1.0-alpha.1`.

The Alpha excludes:

- Chrome Web Store or Edge Add-ons submission.
- A second AI site adapter.
- GitHub Actions automation.
- Auto-update support.
- Sound notifications.
- Webhook integrations.
- Cloud sync.
- Persistent chat content storage.
- A full options/settings page.

## Release Artifact

The preferred user artifact is a GitHub Release zip, for example:

```text
chat-notify-0.1.0-alpha.1.zip
```

The zip must contain only the files needed for the browser extension to run:

- `manifest.json`
- `src/`
- `assets/`
- project license or minimal release metadata only if safe for extension loading

The zip must not include:

- `.git/`
- `node_modules/`
- `tests/`
- `docs/`
- `coverage/`
- development plans or specs
- local OS metadata files

The unpacked zip folder should be loadable directly through Chrome or Edge extension developer mode.

## Repository Presentation

The public repository should communicate these points quickly:

- What Chat Notify does.
- That the Alpha supports ChatGPT only.
- That it is privacy-conscious and does not upload chat content.
- How to install from GitHub Releases.
- How developers can clone, test, and load the extension from source.
- How to enable debug logs only when diagnosing a problem.
- What limitations are known.
- How to report issues.

The README should remain the main project landing document. It should not become a long ordinary-user manual. Detailed installation and troubleshooting should move into docs files that the README links to.

## Documentation Set

### `README.md`

The README should cover:

- Project summary.
- Alpha status.
- Supported browsers and sites.
- Recommended install path using GitHub Releases.
- Developer install path using source checkout.
- Test command.
- Privacy summary.
- Current limits.
- Links to install, troubleshooting, release, and contribution sections or files.

### `docs/INSTALL.md`

The install guide should cover:

- Downloading the latest GitHub Release zip.
- Unzipping it.
- Loading the folder in Chrome.
- Loading the folder in Edge.
- Enabling browser/system notifications.
- Using the test notification button.
- Sending a ChatGPT prompt to validate real behavior.
- Updating to a newer Alpha zip.

The guide should be usable by someone who has never loaded an unpacked extension before.

### `docs/TROUBLESHOOTING.md`

The troubleshooting guide should cover:

- Test notification does not appear.
- ChatGPT response completion notification does not appear.
- Prompt excerpt looks wrong.
- Extension appears stale after pulling or downloading a new version.
- How to enable debug logs.
- Where to find page console logs.
- Where to find service worker logs.
- What information to include when opening a GitHub issue.

The guide should avoid asking users to paste full chat content.

### `docs/RELEASE.md`

The release guide should cover:

- Updating version fields.
- Running tests.
- Running the package script.
- Inspecting the zip contents.
- Loading the packaged folder locally before publishing.
- Creating a GitHub Release.
- Naming the release and artifact.
- Writing release notes for Alpha users.

The release guide is for maintainers, not ordinary users.

### `LICENSE`

The project uses the MIT License.

## Packaging

The package flow should be local and simple:

```bash
npm run package
```

The command should:

1. Remove any previous package output.
2. Create a clean temporary extension directory.
3. Copy only extension runtime files into that directory.
4. Create a zip artifact under a predictable output directory.
5. Print the generated artifact path.

The package flow should be implemented in a small Node script using built-in Node APIs when practical. If creating zip files needs a dependency, the dependency should be small and development-only. The first Alpha should not introduce a full build tool.

## Versioning

The first Alpha version should be:

```text
0.1.0-alpha.1
```

The extension manifest and `package.json` should use compatible version values. If Chrome rejects prerelease strings in `manifest.json`, the manifest can use `0.1.0` while `package.json`, README, and release artifact names use `0.1.0-alpha.1`. The release guide must document this split clearly if it is needed.

## Privacy And Safety

The Alpha must preserve the current privacy model:

- No project-owned server.
- No third-party analytics.
- No chat content upload.
- No persistent prompt or assistant content storage.
- Prompt excerpts remain short and local.
- Debug logs are off by default.

Documentation should warn that debug logs may include prompt excerpts, so users should disable debug logs after diagnosis and avoid posting sensitive logs publicly.

## Quality Bar

Before calling the Alpha ready:

- `npm test` passes.
- The package script creates the expected zip.
- The zip contents are inspected and do not include development files.
- The packaged extension loads in Chrome or Edge.
- The test notification works.
- A real ChatGPT prompt produces a completion notification.
- README, install guide, troubleshooting guide, and release guide are internally consistent.

## Open Source Readiness

The Alpha should be ready to push to GitHub after implementation. A first public repository should include:

- Source code.
- Tests.
- MIT license.
- README.
- Install guide.
- Troubleshooting guide.
- Release guide.
- Package script.

Optional files such as `CONTRIBUTING.md`, `SECURITY.md`, issue templates, or GitHub Actions can be added later. They are useful, but they are not required for this Alpha.

