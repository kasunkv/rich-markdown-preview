# Styled Markdown Preview

A local-first VS Code extension with three reading styles, live updates, syntax-highlighted code, Mermaid diagrams, and configurable typography.

Browser QA screenshots are included in the `docs` folder.

## Try locally

1. Install Node.js and open this repository in VS Code.
2. Run `npm install` and `npm run check`.
3. Press **F5** to build and launch the Extension Development Host.
4. In that new window, open `samples/showcase.md` from this repository.
5. Right-click in the Markdown editor or on a Markdown file in Explorer and choose **Open Styled Markdown Preview**. You can also run **Open Styled Markdown Preview** from the Command Palette or use the Markdown editor title action.

Use the preview toolbar to choose a style and appearance, adjust width/font size/line spacing, wrap code, or hide the heading outline. Settings save at workspace-folder scope when a file belongs to a workspace, otherwise globally. Auto appearance follows the VS Code theme.

Reading controls apply instantly. The width slider resizes the content while you drag, then saves when you release it. Changing layout does not rebuild the Markdown or diagrams; changing light/dark appearance refreshes diagram colors while keeping the document in place.

If settings cannot be saved (for example, an invalid or read-only settings file), the selected appearance stays active in the current preview. A warning includes the actual save error; unsaved changes last until the preview closes.

## Included

- Documentation, Reading, and Technical styles; light/dark/automatic appearance.
- Live preview while typing, with debounced updates and scroll position retention.
- Syntax highlighting, language labels, and code copy buttons.
- Mermaid flowcharts and sequence diagrams, rendered locally without a CDN.
- Tables, blockquotes, lists, links, images, and heading navigation.
- Relative images within the Markdown file's directory; local links open in VS Code.
- Raw HTML is displayed as text; document scripts are never executed.

## Development

```sh
npm run check
npm run build
npm test
```

`npm run watch` rebuilds JavaScript changes. CSS is copied during build; rerun build after CSS changes, and reopen the preview after changing webview assets. F5 builds automatically.

`npm run dev:preview` opens a browser QA server at `http://127.0.0.1:4173`. This harness uses the same rendering assets and sample document, with a simulated VS Code bridge; it does not test extension-host integration.

Initial validation: TypeScript check, bundled build, four renderer tests, VSIX packaging, and browser checks of style switching, dark appearance, code wrapping, outline navigation, flowcharts, and sequence diagrams passed. The installation audit reported zero vulnerabilities. Run the F5 workflow above to verify integration in your VS Code installation.

## Install in your regular VS Code

Run `npm run package`, then select **Extensions: Install from VSIX...** in VS Code and choose the generated `.vsix` file. No Marketplace account is required for local installation.

Before publishing, replace the placeholder `publisher` in `package.json` with your registered Marketplace publisher ID, add repository metadata and screenshots, review dependency licenses, and test the packaged extension. This project has not been published.

## Initial version limitations

The preview retains its own scroll position but does not synchronize scrolling with the source editor. There is no export, math typesetting, task checkbox interaction, or custom CSS support yet. Remote images require HTTPS and a network connection. Parent-directory images outside the document resource root are not supported. Closing the preview requires reopening it; panels are not restored across window restarts. Large documents and many diagrams may take longer to render.
