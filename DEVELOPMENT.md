# Developing Rich Markdown Preview

This guide describes the public contributor workflow. See [CONTRIBUTING.md](CONTRIBUTING.md)
for review requirements and the repository publication policy.

## Setup and debugging

Use Node.js 24.x (at least 24.12.0) and npm 11.x. Run `npm ci`, open this repository
in VS Code, and press **F5** to build and launch an Extension Development Host.
Open `samples/showcase.md` and run **Open in Rich Markdown Preview**.
The shared launch and task files use workspace-relative paths; keep personal
preferences in the ignored `.vscode/settings.json`.

`npm run build:development` produces readable bundles and source maps.
`npm run watch` rebuilds source and static assets. Reopen preview panels after
browser/CSS changes, and restart the development host after host-code changes.
`npm run dev:preview` prints an allocated loopback URL for browser QA.

`npm run build:production` minifies bundles and regenerates dependency notices.
Stop watch mode before building into the same `dist/` directory. Build targets
are Node 20 and Chromium 128 for the VS Code 1.95 minimum; contributor tooling
uses the newer Node/npm versions above.

## Validation

```sh
npm run check:quality
npm test
npm run browser:install
npm run test:browser
npm run test:coverage
npm run test:mutation
npm run test:host
```

`npm run validate:release` adds dependency and package checks to the combined
validation workflow. See [source coverage policy](docs/SOURCE_COVERAGE.md) for
coverage floors, safety branches and mutation requirements. Node/VM tests mock
the host API; real VS Code checks remain necessary.

Host tests download an isolated VS Code installation and create disposable
fixtures/profiles under `.test-results/`. Use `npm run test:host:only -- --version stable`
to check Stable after a production build. After packaging, use
`npm run test:host:package -- --version 1.95.0` and repeat with `stable`.
Never point these tests at a personal profile or private workspace.

See [examples/README.md](examples/README.md) for manual QA. Only
`npm run screenshots:marketing` regenerates the two public README screenshots.
Ordinary tests leave them unchanged. Logs, traces, screenshots, coverage maps
and profiles are local diagnostics; inspect them before sharing any evidence.

## Source layout

- `src/extension.ts`: commands, panels and the host bridge.
- `src/documentation.ts` and `src/documentation-view.ts`: discovery and Documentation Home.
- `src/render.ts`, `src/references.ts` and `src/frontmatter.ts`: Markdown rendering and references.
- `src/preview.ts`, `src/tables.ts`, `src/styles.ts` and `src/preview.css`: preview interaction and presentation.
- `build.mjs`: production/development bundles and bundled dependency notices.
- `scripts/` and `tests/`: validation, packaging and synthetic test fixtures.

## Packaging and release validation

Update `package.json` and both lockfile version fields together, for example with
`npm version <version> --no-git-tag-version`. Add a nonempty changelog section for
that exact version, then run `npm run package`. The package verifier checks
identity, release notes, required files, runtime dependencies and size budgets.
`npm run verify:release -- path/to/candidate.vsix --tag v<version>` checks an
existing candidate without publishing it.

`package.json.files` is the exact VSIX allowlist. Git ignore rules do not control
Marketplace packaging. Include only runtime bundles, required metadata/licenses,
the processed product icon and referenced public screenshots. Source maps,
fixtures, local documentation and diagnostic output must not ship.

The protected release workflow validates one immutable candidate, runs its
compatibility matrix and promotes those exact bytes. Publishing requires the
configured protected environments, reviewed identities and explicit publication
enablement. Do not substitute a locally rebuilt package during recovery.
Keep account-specific setup, authorization and recovery records in `.local-docs/`.
