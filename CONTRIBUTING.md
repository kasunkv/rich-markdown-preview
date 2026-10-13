# Contributing to Rich Markdown Preview

Use Node.js 24.12.0 or a newer 24.x release and npm 11.x. `.nvmrc` pins the reference Node version; `.npmrc` enforces the supported
development versions in `package.json`. These are development tools, separate
from the extension's VS Code 1.95 minimum and Node 20/Chromium 128 build targets.

## Setup and validation

Clone the repository, select the Node version with `nvm use` if available, then:

```sh
npm ci
npm run check:quality
npm run check:dependencies
npm test
npm run test:coverage
```

Use `npm ci` for reproducible installs from `package-lock.json`. Use `npm install`
only when intentionally changing dependencies and commit both manifest and lockfile.
Run `npm run format` to fix formatting and `npm run lint:fix` for lint fixes that
ESLint can apply. Review their diff before committing. Quality CI runs the same
checks on pushes and pull requests. The packaging prepublish gate also runs them.

Formatting covers TypeScript source and the quality/workflow files listed in the
package scripts. Existing examples, generated assets and historical documentation
are outside this initial formatting scope. TypeScript linting uses the project's
strict compiler configuration. Add new workflow files to the formatter scope.

For browser or webview changes, install the isolated test browser with
`npm run browser:install` and run `npm run test:browser`. For host changes,
run `npm run test:host` for the downloaded minimum host and
`npm run test:host:only -- --version stable` for current stable, then follow the
installed-VSIX smoke test and F5 instructions in
[DEVELOPMENT.md](DEVELOPMENT.md). Use fixtures, mocked services and isolated user
profiles. Never publish a test build or modify a developer's real settings.

Coverage currently reports bundled JavaScript, including vendor code. There is
no source-only coverage ratchet in this checkout; record fresh coverage evidence
and preserve existing regressions. Spec 030 defines the final source-coverage
target. Do not claim bundled percentages are source coverage.

## Asynchronous operations and review

Await or return privileged operations (settings writes, clipboard access, file
exports, external links and commands) so their errors and completion remain
observable. Preserve serialized preference writes and existing failure messages.
The lint rules check Promise-like VS Code Thenables as well as native Promises;
`void` does not waive rejection handling. For deliberately detached work such as
webview notifications and watcher refreshes, use `reportAsync` from `src/async.ts`,
which logs failures, or provide an explicit rejection handler. VS Code does not
consume event callback results; the async message callback therefore catches its
own failures. Keep error handling at the operation boundary.

Keep changes focused. Include the behavior before/after, current-run validation,
coverage limitations and risks in the PR template. Add meaningful regression
tests for behavior changes. Changes affecting trust, resource roots, CSP,
navigation, webview messages, dependencies or release tooling need maintainer
review through CODEOWNERS. GitHub branch protection must separately require these
reviews; the file alone does not enforce approval.

Retain the publisher identity and legacy command/settings compatibility unless a
compatibility decision is explicitly documented. Use [SECURITY.md](SECURITY.md)
for private vulnerability reports; public issues must not contain exploit details
or secrets. Follow [DEVELOPMENT.md](DEVELOPMENT.md) for release/package validation.

## Repository account prerequisites

Local checks do not establish whether GitHub code scanning, secret scanning,
private vulnerability reporting or branch protection are enabled. Their account
availability/settings have not been verified for this implementation. A repository
administrator should inspect Settings > Security and branch rules, record the
enabled protections and confirm the private reporting mailbox is monitored.
Weekly npm and GitHub Actions update configuration and advisory/package checks
are implemented by spec 008. See [dependency maintenance](docs/implementation/spec-008.md)
for license policy, dated advisory exceptions, the KaTeX override and actual
account activation limits. The configuration must reach the default branch before
GitHub can run it; verify a real update PR before recording activation.

## Reproducible browser validation

`npm run test:browser` builds production assets and runs the browser harness regressions and both Playwright suites. After an existing production build, use `npm run test:browser:only`. Chromium comes from the exact Playwright version in the lockfile; executable overrides are not supported. On Linux CI, `npm run browser:install:ci` explicitly installs Chromium and system dependencies.

Each Playwright invocation writes `.test-results/browser/<timestamp-UUID>/run.json` with its commit, version, timestamps and final status, plus a JSON report and runner log. Treat `running`, `interrupted` or `failed` as incomplete or failed validation. Failed browser assertions retain a trace, screenshot and browser console attachment. Use `npx playwright show-trace <trace.zip>` to inspect a trace. A browser launch or setup failure may have no screenshot or trace; its current runner log and report remain available.

Workers bind loopback port 0 and own their HTTP server in-process, so simultaneous runs use separate ports and process termination cannot orphan a server. Startup fixtures have a 10-second limit, navigation 15 seconds, actions 10 seconds and the suite 3 minutes. External network requests are blocked. These are mocked webview behavior tests; production CSP and real VS Code host compatibility have separate suites.

Ordinary browser runs never regenerate README images. `npm run screenshots:marketing` explicitly rebuilds and writes the two tracked marketing images. Review those image changes separately. `npm run validate` runs quality checks, one production build, fresh unit coverage, browser validation and the minimum VS Code host checks. Browser installation and host download require network access on first setup; stable and installed-VSIX host checks remain documented separately.
