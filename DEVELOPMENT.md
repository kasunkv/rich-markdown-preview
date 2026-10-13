# Developing Rich Markdown Preview

Package: `rich-markdown-preview`. Display name: **Rich Markdown Preview - A Styled Markdown Preview**. Publisher ID: `kasunkodagoda`. The command is `richMarkdownPreview.openPreview`, settings use `richMarkdownPreview.*`, and the webview type is `richMarkdownPreview.preview`. Legacy `markdownLens.*` and `styledMarkdown.*` settings are read only as a fallback when the corresponding new setting is not explicitly configured. Toolbar changes save to the new namespace. Both old preview commands remain unlisted compatibility aliases for existing keybindings.

## Local setup

Use Node.js 24.12.0 or newer within 24.x and npm 11.x (see `.nvmrc` and [CONTRIBUTING.md](CONTRIBUTING.md)). Run `npm ci`, open this repository in VS Code, and press **F5** to build and launch an Extension Development Host. Open `samples/showcase.md` and run **Open in Rich Markdown Preview**.

```sh
npm run check:quality
npm test
npm run test:browser
npm run test:coverage
```

`npm test` builds the production profile first and runs renderer, host-bridge, settings, table data, palette, manifest, build/watch, and packaging regressions. Host tests mock VS Code APIs; they do not replace the extension-host smoke test. Coverage output currently measures bundled JavaScript, including vendor code; do not interpret it as a source-only coverage percentage.

Browser checks use Playwright and exercise the shipped preview bundle, actual Mermaid rendering, 36 style/appearance combinations, table DOM controls, state retention, clipboard, CSV download/BOM, automatic theme changes, error recovery, and narrow layouts. Results are saved to `.test-results/browser.json`. The test also regenerates README screenshots from the actual preview using a simulated VS Code bridge.

Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium-compatible browser. On Windows:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:browser
```

`npm run dev:preview` builds the development profile and serves browser QA at `http://127.0.0.1:4173`. Do not run that server concurrently with the browser suite.

## Build profiles and debugging

`npm run build:development` creates readable bundles and adjacent `.map` files
with embedded TypeScript source. F5 runs this profile before launching the
Extension Development Host; `outFiles` and source-map support are configured in
`.vscode/launch.json`. Set breakpoints in `src/extension.ts` before running a
preview command. Debug browser code in the webview developer tools.

`npm run watch` uses the same development profile and watches both TypeScript
and the static assets listed in `build.mjs` (currently `src/preview.css`). CSS
edits, including editor saves that replace the file, recopy it to `dist` without
restarting the watcher. `[watch] ready` means the initial outputs are available;
Ctrl+C disposes all esbuild contexts. Reopen preview panels after CSS/browser
bundle changes so they load the updated assets. Restart the Extension
Development Host after extension-host code changes. In browser QA, refresh the
page after asset changes; automatic panel/page reload is not provided.

`npm run build:production` minifies bundles, removes known development maps from
`dist`, and regenerates `THIRD_PARTY_NOTICES.txt` from bundled dependencies.
`npm run build` remains an alias for production. Test-only renderer/table bundles
are built in both profiles but excluded from the VSIX by the exact allowlist.
Stop watch mode before building production into the shared `dist` directory.

Targets are explicitly `node20` for host/test code and `chrome128` for webview
code, matching the Node 20.18 / Chromium 128 runtime in the supported
[VS Code 1.95 floor](https://code.visualstudio.com/updates/v1_95#_electron-32-update).
The local build/test tools use the Node 24.x/npm 11.x contributor policy. These transpilation
targets do not substitute for the minimum-version real-host checks in spec 005.

CI can build once and reuse the outputs:

```sh
npm run check:quality
npm run build:production
npm run test:only
npm run test:coverage:only
npm run test:browser:only
```

The `:only` commands never build and require existing outputs. Use
`test:package:only` for only the package fixture checks. The convenience commands
`test`, `test:coverage`, `test:browser`, and `test:package` each build production
first. VSCE's prepublish hook runs type/lint/format checks, one production build and
`test:only`; `npm run package` then verifies the resulting release ZIP.

## Fixtures and manual QA

`examples/master-test.md` covers Markdown constructs. Other examples focus on typography, code, tables, diagrams, links/images, edge cases, and styles. See [the manual checklist](examples/README.md).

Run the real VS Code extension-host smoke test with the official
[`@vscode/test-electron` runner](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
API types are pinned to `1.95.0`, matching the supported floor. The runner
downloads its own host; no locally installed VS Code is used.

```powershell
npm run test:host
npm run test:host:only -- --version stable
npm run package
npm run test:host:package -- --version 1.95.0
npm run test:host:package -- --version stable
# Optional exact version for replay, or insiders for compatibility checks:
npm run test:host:only -- --version 1.141.0
```

Each invocation copies deterministic fixtures into a new directory under
`.test-results/host/` and creates fresh user/extensions profiles there. Host
downloads are cached separately under `.test-results/host-downloads/`.
`result.json` records requested/actual version, OS, architecture, source commit,
dirty-checkout flag, timestamps and outcome. `suite.json` records individual
checks. Package results also record the candidate path and SHA-256. A failed
assertion, startup, install, download or missing suite report exits nonzero.
Use an exact recorded version to replay a stable run.

The same suite checks identity, command aliases, folder settings, eighteen styles,
plaintext `.md` support, native panel placement/reuse, hidden/nested discovery,
runtime resource readability through VS Code URIs, encoded filenames, two
documents, edit/save and panel disposal/reopening. Package mode verifies the
candidate release (use `--vsix path/to/candidate.vsix` to select it), installs it
into an empty profile and develops only an inert test harness. The suite proves
the target comes from the installation directory, so checkout code cannot mask
packaging problems. `test:host:only` requires built outputs; package mode requires
a previously built candidate and does not rebuild it.

To prove failure propagation, run `npm run test:host:package -- --force-failure`.
It must exit nonzero; `node scripts/verify-host-failure.cjs` then verifies that
the latest run reached the deliberately failing assertion rather than failing
during setup. Profiles and logs are retained for diagnosis. Never run the suite
directly against a personal workspace or profile.

The host workflow tests minimum/stable on Linux/Windows PRs, minimum/stable on
Linux/Windows/macOS release tags and manual runs, and Insiders weekly on all
three platforms. Linux uses Xvfb; hosted desktop runners supply Windows/macOS
displays. Network access is needed for npm and official VS Code downloads;
tests do not invoke external links/services. Uploaded artifacts retain current
host evidence, including the expected negative control. GitHub Actions must be
enabled and these jobs can be selected as required PR checks by an administrator.

In a Development Host, also confirm native menus, Command Palette label, visual
icon/image loading and webview appearance. Resource smoke checks establish
host filesystem readability; the browser suite checks rendering and interactions.

## Architecture

- `src/extension.ts`: command, panel lifetime, resource roots, CSP, messages, settings writes, clipboard, links, CSV saves.
- `src/documentation.ts`: path-only workspace index, include/exclude globs, cancellable searches, and filesystem watcher lifecycle.
- `src/documentation-view.ts`: Documentation Home, folder tree, filtering, workspace roots, and navigation controls.
- `src/references.ts`: Markdown parser rules, reference relationships, navigation targets, and dialect path candidates.
- `src/frontmatter.ts`: YAML frontmatter extraction, bounded metadata rendering, escaped source fallback.
- `src/render.ts`: Markdown parsing, heading anchors, highlighting, image rewriting, extended Markdown.
- `src/preview.ts`: toolbar, outline, webview state, Mermaid rendering, appearance refresh.
- `src/tables.ts`: controls, sorting, filtering, state retention, CSV escaping.
- `src/styles.ts` and `src/preview.css`: eighteen style definitions, palettes, responsive layout.
- `build.mjs`: bundles extension/browser code; creates renderer/table bundles for tests.

Raw HTML is disabled. The webview uses a nonce-based script CSP and Mermaid uses strict security mode. Local resources are restricted to the extension directory and Markdown document directory. Links allow HTTP, HTTPS, mailto, and relative files; other explicit schemes are rejected. CSV formula-like text is exported as literal text.

Documentation Home uses a separate panel type (`richMarkdownPreview.documentationHome`) and command (`richMarkdownPreview.openDocumentationHome`), while sharing the existing rendering and message bridge. Its local resources are restricted to the extension and active document's workspace folder, allowing sibling images. Tree requests resolve only through indexed URI IDs. Directory and file names are inserted as text. Activation creates the status bar entry; indexing starts only when Documentation Home opens. Searches use VS Code URIs and APIs, including for remote workspaces.

`tests/documentation.test.cjs` covers the index and host bridge. `tests/documentation-browser.cjs` covers the shipped UI, filtering, keyboard selection, document state, history, dark theme, and responsive layout; its screenshots and report go into `.test-results`. Both browser suites run through `npm run test:browser`. In the Development Host, also verify the native status bar and Explorer actions, hidden folders, folder rename/delete, relative Markdown links/images, and multiple workspace roots.

## Logo

`assets/rich-markdown-preview.png` is the shared icon for the Marketplace, Extensions list, panel tab, and preview toolbar. It was generated with the built-in imagegen tool using this prompt:

> Production square VS Code extension icon for Rich Markdown Preview: a white folded Markdown document with a bold M and downward arrow, overlapped by a green magnifying lens; dark green rounded square, primary #1c7819 green and lighter/darker shades of the same hue, generous margins, clean geometry, readable at 48 pixels; no wordmark, watermark, or mockup.

The user-supplied corrected PNG is preserved in `assets/logo-source.png` (excluded from the VSIX); the shared packaged PNG is resized to 256 × 256 pixels while preserving its alpha transparency, including the transparent exterior corners.

## Release

### Version contract

`package.json.version` is the source of truth and must be valid SemVer, including
valid prerelease/build identifiers. Both `package-lock.json.version` and
`package-lock.json.packages[""].version` must match it exactly. Use `npm version
<version> --no-git-tag-version` to update the manifest and lockfile together.
The manifest and extension-host tests compare versions dynamically; routine
bumps do not require editing test expectations. Publisher/name and legacy
command compatibility checks remain in place.

Ordinary `npm test` permits development changes with only an `Unreleased`
changelog section and requires no tag. `npm run package` additionally runs
`verify:release` against the newly generated VSIX. This release gate requires
one nonempty level-two changelog section for the manifest version in both the
source and packaged changelog, and checks the packaged manifest and VSIX XML
identity against the source manifest. Supported headings are `## 3.1.2`,
`## 3.1.2 — 2026-10-12`, or `## [3.1.2] - 2026-10-12`; `Unreleased`, older
entries, HTML comments and headings inside code blocks do not replace notes.
SemVer acceptance here does not override any VSCE/Marketplace restrictions.

```sh
npm run verify:release
npm run verify:release -- path/to/candidate.vsix --tag v3.1.2
```

In PowerShell, you can pass the tag directly with
`node scripts/verify-release.cjs --tag v<manifest-version>`.

The default candidate filename follows the manifest name/version. A tag is
optional, but when supplied it must be exactly `v` plus the manifest version.
Release CI should pass its tag explicitly with `--tag`; this command does not
infer tags from the checkout or environment. Failures identify the mismatched
field and expected/actual version, or the missing/empty notes entry, and exit
nonzero. `verify:vsix` remains an inventory/metadata check for development
candidates; use `verify:release` for release approval. Neither command publishes.

### Package inventory and verification

`package.json.files` is the single VSCE inclusion policy: exact runtime files,
customer README/changelog/license, bundled notices, shared icon, and the two
README screenshots. Add customer assets explicitly; do not add directory globs
or restore `.vscodeignore`. Source maps, test bundles, source/fixtures, build
tools, developer documentation, specs, audits, research and caches never ship.
Git ignore rules do not control the customer package.

`npm run package` runs the existing prepublish checks and then verifies the
actual ZIP. To verify a candidate independently, use
`npm run verify:vsix -- path/to/candidate.vsix` (the default is the current
manifest's name/version). The verifier requires the exact inventory, nonempty
assets, manifest and VSIX identity, and the declared runtime entrypoint. Its JSON
output lists each path's compressed/uncompressed bytes, ZIP size and total
uncompressed size. VSCE normalizes README/changelog/license names in the ZIP.

The initial corrected 2.0.0 package measured 1,657,052 ZIP bytes and 5,341,299
uncompressed bytes on 12 October 2026. `scripts/vsix-budget.json` limits these to
2,000,000 and 6,500,000 bytes respectively (about 21% headroom). Review inventory
and measured growth before changing these budgets. `npm run test:package` builds
and packages clean and sentinel-filled temporary fixture trees, exercises
missing-runtime and malformed-package failures, and removes the fixtures. The
package test also runs in the existing regression and coverage commands.

Installation validation uses `code --install-extension` with explicit isolated
`--user-data-dir` and `--extensions-dir` paths under `.test-results`; never omit
these when testing a candidate. This spec changes packaging only, with no
customer settings or runtime behavior changes.

1. Confirm `package.json.publisher` matches your registered ID (`kasunkodagoda`). Set the Marketplace publisher display name to **Kasun Kodagoda** in the publisher account; the package author already uses that name.
2. Push the release files, screenshots, and developer documentation to the public `master` branch of https://github.com/kasunkv/rich-markdown-preview. The package links use this repository; VSCE rewrites relative README links to that branch.
3. Run type checking, regressions, browser tests, and the extension-host smoke test. Review screenshots and manually verify native menus and the icon.
4. Run `npm audit` and review dependency licenses. Runtime dependencies are bundled; source, tests, fixtures, and `node_modules` are excluded from the VSIX. Preserve bundled third-party notices in `THIRD_PARTY_NOTICES.txt`.
5. Update `CHANGELOG.md` and the manifest/lockfile versions, then run `npm run package`. Type checking and regressions run through `vscode:prepublish`; release versions and notes are checked against the resulting VSIX. For a tagged release, also run `npm run verify:release -- --tag v<manifest-version>`.
6. Install the resulting VSIX in a clean VS Code profile and verify the customer workflow.
7. Upload it through [Marketplace publisher management](https://marketplace.visualstudio.com/manage), or use authenticated `vsce publish` according to [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

Packaging uses the supplied GitHub repository and its `master` branch to resolve README screenshots and documentation. Ensure those files are public before uploading the VSIX.

## Marketplace upload troubleshooting

`npm run package` runs `vscode:prepublish`, which checks types/lint/formatting, rebuilds the assets, and runs regression tests, followed by release validation. A separate `npm run build` is optional. Upload `rich-markdown-preview-<manifest-version>.vsix` as a new version of the existing extension under publisher `kasunkodagoda`.

The internal package name is `rich-markdown-preview`. The visible name is **Rich Markdown Preview - A Styled Markdown Preview**. Check the current Marketplace for package and display-name collisions before changing either value. A successful local build does not guarantee server-side Marketplace approval.

For opaque upload failures, open the browser developer tools before retrying and inspect the failing upload request's response. Capture the status, error message, and request/correlation ID; do not share cookies or authentication headers. If Marketplace still rejects a valid package, use its **Contact Microsoft** link and include that diagnostic information.
