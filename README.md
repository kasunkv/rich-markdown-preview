# Styled Markdown Preview

A local-first VS Code extension with eighteen reading styles, live updates, syntax-highlighted code, Mermaid diagrams, and configurable typography.

Browser QA screenshots are included in the `docs` folder.

## Try locally

1. Install Node.js and open this repository in VS Code.
2. Run `npm install` and `npm run check`.
3. Press **F5** to build and launch the Extension Development Host.
4. In that new window, open `samples/showcase.md` from this repository.
5. Right-click in the Markdown editor or on a Markdown file in Explorer and choose **Open Styled Markdown Preview**. You can also run **Open Styled Markdown Preview** from the Command Palette or use the Markdown editor title action.

For broader testing, open `examples/master-test.md`. The `examples` folder also contains focused typography, code, table, diagram, link/image, and edge-case fixtures, plus a manual test checklist in `examples/README.md`.

Use the preview toolbar to choose a style and appearance, adjust width/font size/line spacing, wrap code, or hide the heading outline. Settings save at workspace-folder scope when a file belongs to a workspace, otherwise globally. Auto appearance follows the VS Code theme.

Reading controls apply instantly. The width slider resizes the content while you drag, then saves when you release it. Changing layout does not rebuild the Markdown or diagrams; changing style or light/dark appearance refreshes diagram colors while keeping the document in place.

If settings cannot be saved (for example, an invalid or read-only settings file), the selected appearance stays active in the current preview. A warning includes the actual save error; unsaved changes last until the preview closes.

Code text keeps a transparent background. Each style coordinates syntax colors, code panels, and locally rendered Mermaid diagrams and charts. See `examples/08-style-gallery.md` for a typography and visualization showcase.

## Included

- Eighteen reading styles, including Swiss, Aurora, Botanical, Noir, Blueprint, Terracotta, Atelier, Ocean, Manuscript, and Circuit; light/dark/automatic appearance.
- Live preview while typing, with debounced updates and scroll position retention.
- Syntax highlighting, language labels, and code copy buttons.
- Mermaid flowcharts and sequence diagrams, rendered locally without a CDN.
- Tables with contrasting accent headers, alternating rows, sticky headers, sortable columns, search, spacing controls, and CSV copy/export; blockquotes, lists, links, images, and heading navigation.
- Read-only task-list checkboxes, emoji shortcodes, footnotes, definition lists, highlighted text, subscript/superscript, and GitHub-style Note/Tip/Important/Warning/Caution callouts.
- Relative images within the Markdown file's directory; local links open in VS Code.
- Raw HTML is displayed as text; document scripts are never executed.

## Interactive tables

Each table has its own controls, in all eighteen styles and both appearances:

- Click a column header to cycle through ascending, descending, and original document order. Text sorts naturally (Item 2 before Item 10); numbers sort numerically. Empty cells remain last.
- Search filters rows across all columns, ignoring case. The row count shows how many rows match, and Reset clears search and restores source order.
- Choose Comfortable or Compact spacing independently for each table.
- Long tables scroll inside a bounded panel with sticky column headers. Wide tables scroll horizontally; focus the table region and use the arrow keys.
- Copy CSV copies the header and currently displayed rows in their current order. Export CSV saves the same data through VS Code's Save dialog, using UTF-8 with a BOM for Unicode compatibility. Quotes, commas, and line breaks are escaped; formula-like text is exported as literal text.

Table controls change the preview view. Search, sort, and spacing choices survive live refreshes and webview restoration when the table's position and column headers stay the same. See `examples/09-interactive-tables.md` to try all controls.

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
| Swiss | Bold geometric headings, crisp red rules, and neutral sans-serif text. | Design documents |
| Aurora | Purple display headings and soft, rounded sans-serif typography. | Product narratives |
| Botanical | Olive accents, humanist text, and graceful serif headings. | Thoughtful essays |
| Noir | Dramatic serif titles, gold accents, and restrained monochrome text. | Portfolios and reviews |
| Blueprint | Monospaced section labels and structured blue technical panels. | Architecture and specifications |
| Terracotta | Warm clay colors, generous serif prose, and sculpted headings. | Travel and personal writing |
| Atelier | Fashion-inspired display serif titles and small uppercase section labels. | Creative briefs |
| Ocean | Airy sans-serif text, teal heading markers, and cool chart colors. | Guides and tutorials |
| Manuscript | Classic literary serif typography and chapter-style section ornaments. | Literary essays |
| Circuit | Precise sans-serif text, monospace headings, and green engineering accents. | Engineering notes |

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
