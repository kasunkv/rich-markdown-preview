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
npm run test:mutation
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

Coverage instruments original first-party TypeScript before bundling and includes
untouched executable modules. The existing baseline ratchet remains active;
95% lines/statements/functions and 90% branches are required globally, per module
and for changed executable code. Set COVERAGE_BASE to the intended base commit
when checking an integration diff; local runs default to HEAD^.

Source changes require reviewing safety-policy.json checksums, safety-branches.json
locations and any safety-exceptions.json proofs. Hashes normalize CRLF to LF for
portable checkouts. Every reachable reviewed policy arm must execute; only narrow
technically unreachable arms may have an owned, expiring proof. Do not reduce
denominators, refresh checksums without reviewing the policy, or lower inherited
floors. Keep Node/VM/browser counters separate from actual Electron evidence.

Focused mutations run in disposable source copies and require behavioral assertion
kills after successful compilation; source restoration is automatic. The mutation
baseline must not regress. See docs/implementation/spec-030.md for the current
inventory, proofs and evidence.

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

Ordinary browser runs never regenerate README images. `npm run screenshots:marketing` explicitly rebuilds and writes the two tracked marketing images. Review those image changes separately. `npm run validate` runs quality checks, fresh source coverage (including production packaging and instrumented Node/browser suites), focused mutations, browser harness controls and the minimum VS Code host checks. Coverage restores production assets before the host run. Browser installation and host download require network access on first setup; stable and installed-VSIX host checks remain documented separately.

Full release validation is available with `npm run validate:release`; it adds dependency and package checks to `validate`. Publication is a separate authorized step.
