# Developing Markdown Lens

Package: `markdown-lens`. Display name: **Markdown Lens - A Styled Markdown Preview**. Publisher ID: `kasunkodagoda`. The command is `markdownLens.openPreview`, settings use `markdownLens.*`, and the webview type is `markdownLens.preview`. Legacy `styledMarkdown.*` settings are read only as a fallback when the corresponding new setting is not explicitly configured. Toolbar changes save to the new namespace. The old preview command remains an unlisted compatibility alias for existing keybindings.

## Local setup

Use Node.js 22 or newer. Run `npm ci`, open this repository in VS Code, and press **F5** to build and launch an Extension Development Host. Open `samples/showcase.md` and run **Open in Markdown Lens**.

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

This checks registration, folder-scoped settings, all eighteen style values, and command invocation. Results go to `.test-results/vscode-settings.json`. In a Development Host, also confirm editor and Explorer context menus, Command Palette label, extension icon, multiple documents, local images/links, theme changes, and disposing/reopening panels. Browser screenshots show the preview; they do not show native VS Code menus.

## Architecture

- `src/extension.ts`: command, panel lifetime, resource roots, CSP, messages, settings writes, clipboard, links, CSV saves.
- `src/render.ts`: Markdown parsing, heading anchors, highlighting, image rewriting, extended Markdown.
- `src/preview.ts`: toolbar, outline, webview state, Mermaid rendering, appearance refresh.
- `src/tables.ts`: controls, sorting, filtering, state retention, CSV escaping.
- `src/styles.ts` and `src/preview.css`: eighteen style definitions, palettes, responsive layout.
- `build.mjs`: bundles extension/browser code; creates renderer/table bundles for tests.

Raw HTML is disabled. The webview uses a nonce-based script CSP and Mermaid uses strict security mode. Local resources are restricted to the extension directory and Markdown document directory. Links allow HTTP, HTTPS, mailto, and relative files; other explicit schemes are rejected. CSV formula-like text is exported as literal text.

## Logo

`assets/markdown-lens.png` is the shared icon for the Marketplace, Extensions list, panel tab, and preview toolbar. It was generated with the built-in imagegen tool using this prompt:

> Production square VS Code extension icon for Markdown Lens: a white folded Markdown document with a bold M and downward arrow, overlapped by a green magnifying lens; dark green rounded square, primary #1c7819 green and lighter/darker shades of the same hue, generous margins, clean geometry, readable at 48 pixels; no wordmark, watermark, or mockup.

The user-supplied corrected PNG is preserved in `assets/logo-source.png` (excluded from the VSIX); the shared packaged PNG is resized to 256 × 256 pixels while preserving its alpha transparency, including the transparent exterior corners.

## Release

1. Confirm `package.json.publisher` matches your registered ID (`kasunkodagoda`). Set the Marketplace publisher display name to **Kasun Kodagoda** in the publisher account; the package author already uses that name.
2. Push the release files, screenshots, and developer documentation to the public `main` branch of https://github.com/kasunkv/markdown-lens. The package links use this repository; VSCE rewrites relative README links to that branch.
3. Run type checking, regressions, browser tests, and the extension-host smoke test. Review screenshots and manually verify native menus and the icon.
4. Run `npm audit` and review dependency licenses. Runtime dependencies are bundled; source, tests, fixtures, and `node_modules` are excluded from the VSIX. Preserve bundled third-party notices in `THIRD_PARTY_NOTICES.txt`.
5. Update `CHANGELOG.md` and version, then run `npm run package`. Type checking and regressions run through `vscode:prepublish`.
6. Install the resulting VSIX in a clean VS Code profile and verify the customer workflow.
7. Upload it through [Marketplace publisher management](https://marketplace.visualstudio.com/manage), or use authenticated `vsce publish` according to [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

Packaging uses the supplied GitHub repository and its `main` branch to resolve README screenshots and documentation. Ensure those files are public before uploading the VSIX.
