# Markdown preview test examples

Open a file below, right-click, and select **Open Styled Markdown Preview**.

For browser-only visual QA after `npm run build`, run `node tests/preview-server.cjs examples/master-test.md` and visit `http://127.0.0.1:4173`. Stop the server with Ctrl+C before choosing another fixture. The browser harness does not test VS Code file navigation or settings persistence.

| File | Test focus |
| --- | --- |
| [Master test](master-test.md) | Comprehensive core Markdown, common extensions, diagrams, and failure cases in one document |
| [Typography and lists](01-typography-and-lists.md) | Headings, emphasis, paragraphs, nesting, quotes, and Unicode |
| [Code blocks](02-code-blocks.md) | Highlighting, unknown languages, escaping, copy, and long lines |
| [Tables](03-tables.md) | Alignment, inline formatting, escaped pipes, empty cells, and wide tables |
| [Diagrams](04-diagrams.md) | Nine Mermaid diagram types and one intentional syntax error |
| [Links and images](05-links-and-images.md) | Relative resources, filenames with spaces, references, anchors, and broken resources |
| [Edge cases and extensions](06-edge-cases-and-extensions.md) | Invalid syntax, safe HTML handling, and unsupported extended Markdown |
| [Styles and extended Markdown](07-styles-and-extended-markdown.md) | Eighteen styles, task checkboxes, emoji, footnotes, and callouts |
| [Style gallery](08-style-gallery.md) | Heading typography, code frames, and coordinated charts |
| [Interactive tables](09-interactive-tables.md) | Sorting, filters, spacing, sticky headers, and CSV copy/export |
| [Linked note](assets/linked%20note.md) | Local-link navigation target |

There is no single Markdown dialect containing every extension. The master file covers core/CommonMark constructs, this renderer's built-in table/strikethrough features, Mermaid, and common optional syntax. Unsupported syntax is included as a future-feature test and should remain readable rather than crash the preview.

## Manual test checklist

1. Switch through all eighteen styles. Check heading sizes, paragraph spacing, quotes, lists, checkboxes, and tables.
2. Switch Light, Dark, and Auto. Check code contrast and diagram colors. Auto follows the editor's appearance.
3. Drag width between 480px and 1600px. Content should resize immediately; wide code and tables should scroll inside their own blocks.
4. Change text size and line spacing. Verify that list nesting and table cells stay readable.
5. Toggle Wrap code. Copy a snippet and paste it into a scratch document; indentation and punctuation should match the source.
6. Navigate through the heading outline and in-document anchors. Check repeated headings and Unicode headings.
7. Edit text with the preview open. Valid content after a malformed block should still render where the Markdown grammar permits it.
8. Close and reopen the preview. Confirm saved reading preferences are restored.
9. Open examples from Explorer without opening their source first. The correct file should be previewed.
10. Resize the editor to a narrow split view. Controls should wrap, images should fit, and the outline should hide at the current responsive breakpoint.

## Expected results in version 0.2.0

- Rendered: core Markdown, tables, strikethrough, Mermaid, read-only task checkboxes, emoji shortcodes, footnotes, definition lists, highlights, subscript/superscript, and GitHub-style callouts.
- Extended features not implemented: interactive task editing, math typesetting, YAML metadata handling, custom attributes, and colon-container admonitions.
- Raw HTML and HTML comments are escaped visibly. HTML-based details, embeds, and media are not rendered.
- Invalid Mermaid shows an error and the original source; following Markdown remains usable.
- Broken image targets are intentional in the image tests. Parent-directory images outside the preview's allowed resource directory are not supported.
- Unclosed code fences consume the rest of the document by Markdown rules; the edge-case file puts this case last.
