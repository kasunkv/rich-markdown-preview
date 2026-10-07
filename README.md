# Styled Markdown Preview

A local-first VS Code extension with eight reading styles, live updates, syntax-highlighted code, Mermaid diagrams, and configurable typography.

Browser QA screenshots are included in the `docs` folder.

## Try locally

1. Install Node.js and open this repository in VS Code.
2. Run `npm install` and `npm run check`.
3. Press **F5** to build and launch the Extension Development Host.
4. In that new window, open `samples/showcase.md` from this repository.
5. Right-click in the Markdown editor or on a Markdown file in Explorer and choose **Open Styled Markdown Preview**. You can also run **Open Styled Markdown Preview** from the Command Palette or use the Markdown editor title action.

For broader testing, open `examples/master-test.md`. The `examples` folder also contains focused typography, code, table, diagram, link/image, and edge-case fixtures, plus a manual test checklist in `examples/README.md`.

Use the preview toolbar to choose a style and appearance, adjust width/font size/line spacing, wrap code, or hide the heading outline. Settings save at workspace-folder scope when a file belongs to a workspace, otherwise globally. Auto appearance follows the VS Code theme.

Reading controls apply instantly. The width slider resizes the content while you drag, then saves when you release it. Changing layout does not rebuild the Markdown or diagrams; changing light/dark appearance refreshes diagram colors while keeping the document in place.

If settings cannot be saved (for example, an invalid or read-only settings file), the selected appearance stays active in the current preview. A warning includes the actual save error; unsaved changes last until the preview closes.

## Included

- Documentation, Reading, Technical, GitHub, Editorial, Book, Minimal, and Academic styles; light/dark/automatic appearance.
- Live preview while typing, with debounced updates and scroll position retention.
- Syntax highlighting, language labels, and code copy buttons.
- Mermaid flowcharts and sequence diagrams, rendered locally without a CDN.
- Tables, blockquotes, lists, links, images, and heading navigation.
- Read-only task-list checkboxes, emoji shortcodes, footnotes, definition lists, highlighted text, subscript/superscript, and GitHub-style Note/Tip/Important/Warning/Caution callouts.
- Relative images within the Markdown file's directory; local links open in VS Code.
- Raw HTML is displayed as text; document scripts are never executed.

## Reading styles

All styles use local/system font stacks, work offline, and respect the width, font-size, spacing, and appearance controls. Font availability can vary by operating system.

| Style | Character | Intended use |
| --- | --- | --- |
| Documentation | Balanced sans-serif hierarchy | Guides and documentation |
| Reading | Comfortable Georgia serif text | Long articles |
| Technical | Compact headings and tables | API notes and references |
| GitHub | System sans-serif, neutral colors, bordered tables | Familiar README presentation |
| Editorial | Bold sans-serif headlines, serif prose, warm accents | Magazine-style articles |
| Book | Palatino-style serif, warm paper, centered chapter headings | Essays and book chapters |
| Minimal | Quiet sans-serif, restrained colors, generous whitespace | Focused reading and notes |
| Academic | Cambria-style serif, formal headings, ruled tables | Research and reports |

The GitHub preset draws on [Primer typography](https://primer.style/product/getting-started/foundations/typography/). Serif reading presets use traditional book/editorial conventions and the emphasis on font, size, line spacing, and line length described in [Practical Typography](https://practicaltypography.com/body-text.html). These are original presets, not exact reproductions of another product.

## Extended Markdown

Task lists such as `- [ ] Pending` and `- [x] Complete` render as labeled, read-only checkboxes. Edit the Markdown source to change their state.

Emoji shortcodes such as `:rocket:`, `:smile:`, `:warning:`, `:+1:`, and `:white_check_mark:` render as native Unicode emoji. Unknown shortcodes and shortcodes inside code blocks/spans stay literal. ASCII faces such as `:)` are not automatically converted.

Footnotes (`[^note]`), definition lists (`Term` followed by `: Definition`), `==highlights==`, `H~2~O`, and `x^2^` are supported. GitHub-style callouts start a blockquote with a standalone `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` line. See `examples/07-styles-and-extended-markdown.md` for a compact showcase.

## Development

```sh
npm run check
npm run build
npm test
```

`npm run watch` rebuilds JavaScript changes. CSS is copied during build; rerun build after CSS changes, and reopen the preview after changing webview assets. F5 builds automatically.

`npm run dev:preview` opens a browser QA server at `http://127.0.0.1:4173`. This harness uses the same rendering assets and sample document, with a simulated VS Code bridge; it does not test extension-host integration.

Validation includes renderer and settings regression tests, isolated VS Code extension-host checks of folder settings, and browser QA of styles and rendered content. Run the F5 workflow above to verify behavior in your installation.

## Install in your regular VS Code

Run `npm run package`, then select **Extensions: Install from VSIX...** in VS Code and choose the generated `.vsix` file. No Marketplace account is required for local installation.

Before publishing, replace the placeholder `publisher` in `package.json` with your registered Marketplace publisher ID, add repository metadata and screenshots, review dependency licenses, and test the packaged extension. This project has not been published.

## Initial version limitations

The preview retains its own scroll position but does not synchronize scrolling with the source editor. There is no export, math typesetting, task checkbox interaction, or custom CSS support yet. Remote images require HTTPS and a network connection. Parent-directory images outside the document resource root are not supported. Closing the preview requires reopening it; panels are not restored across window restarts. Large documents and many diagrams may take longer to render.
