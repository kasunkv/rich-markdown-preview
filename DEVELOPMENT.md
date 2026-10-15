# Developing Rich Markdown Preview

Package: `rich-markdown-preview`. Display name: **Rich Markdown Preview - A Styled Markdown Preview**. Publisher ID: `kasunkodagoda`. The command is `richMarkdownPreview.openPreview`, settings use `richMarkdownPreview.*`, and the webview type is `richMarkdownPreview.preview`. Legacy `markdownLens.*` and `styledMarkdown.*` settings are read only as a fallback when the corresponding new setting is not explicitly configured. Toolbar changes save to the new namespace. Both old preview commands remain unlisted compatibility aliases for existing keybindings.

## Local setup

Use Node.js 22 or newer. Run `npm ci`, open this repository in VS Code, and press **F5** to build and launch an Extension Development Host. Open `samples/showcase.md` and run **Open in Rich Markdown Preview**.

```sh
npm run check
npm test
npm run test:browser
npm run test:coverage
```

`npm test` builds first and runs renderer, host-bridge, settings, table data, palette, and manifest regressions. Host tests mock VS Code APIs; they do not replace the extension-host smoke test. Coverage output currently measures bundled JavaScript, including vendor code; do not interpret it as a source-only coverage percentage.

Browser checks use Playwright and exercise the shipped preview bundle, actual Mermaid rendering, 36 style/appearance combinations, table DOM controls, state retention, clipboard, CSV download/BOM, automatic theme changes, error recovery, and narrow layouts. Results are saved to `.test-results/browser.json`. The test also regenerates README screenshots from the actual preview using a simulated VS Code bridge.

Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium-compatible browser. On Windows:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:browser
```

`npm run dev:preview` serves browser QA at `http://127.0.0.1:4173`. Do not run that server concurrently with the browser suite. `npm run watch` rebuilds JavaScript. CSS is copied at build time; rerun the build after CSS changes and reopen preview panels after changing assets.

## Fixtures and manual QA

`examples/master-test.md` covers Markdown constructs. Other examples focus on typography, code, tables, diagrams, links/images, edge cases, and styles. See [the manual checklist](examples/README.md).

Run the real VS Code extension-host smoke test in an isolated profile:

```powershell
code --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/tests/vscode-settings.cjs" --user-data-dir="$PWD/.test-results/vscode-profile" --extensions-dir="$PWD/.test-results/vscode-extensions" "$PWD/tests/fixtures/workspace"
```

This checks registration, folder-scoped settings, all eighteen style values, command invocation, `.md` files with plaintext language, and current-group preview placement. Results go to `.test-results/vscode-settings.json`. In a Development Host, also confirm editor and Explorer context menus, Command Palette label, extension icon, multiple documents, local images/links, theme changes, and disposing/reopening panels. Browser screenshots show the preview; they do not show native VS Code menus.

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


## Public repository boundary

Keep specifications, audits, research, account setup records and local working
notes in the ignored `.local-docs/` directory. Only reviewed public documents and
screenshots belong in `docs/`; add them to its `.gitignore` allowlist explicitly.
Personal editor preferences, environment files, credentials, keys, build outputs,
profiles and diagnostic logs must stay untracked. Back up local-only material
privately. Do not force-add ignored files.

Run `npm run check:publication` before committing. CI also runs checksum-pinned
Gitleaks against Git history. Configure required PR checks, GitHub secret scanning
and push protection in repository settings where available. Never use private
workspace content or real credentials as test fixtures, and inspect CI logs
before sharing diagnostics. Ignore rules do not make uploaded artifacts private.

## Packaging

Keep package identity and versions consistent with the lockfile, document changes
in `CHANGELOG.md`, and run the build, tests and isolated host checks before creating
a package. `package.json.files` is the exact runtime-package allowlist; developer
documentation, source maps, fixtures, local notes and credentials must not ship.
Publishing and account configuration are separate maintainer operations.
