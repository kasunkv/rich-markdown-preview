# Changelog

## 1.1.0 — 2026-10-09

- Added YAML frontmatter rendering in an expanded, collapsible metadata card above the document, with nested fields and an original-source view. Invalid YAML remains visible.
- Added clickable includes, imports, embeds, and local file links with relationship icons and syntax tooltips. Supported forms include custom include directives, Claude imports, DocFX, PyMdown, Jekyll, Retype, Obsidian, include comments, Markdown Include, and Docsify references. Includes open their source files without expanding their contents inline.
- Added `richMarkdownPreview.referenceRoot` for project-root or skill-package references.
- Fixed preview access for `.md` files regardless of the selected editor language, including editor title, editor context, and Explorer context actions.
- Added Ctrl+Alt+M (Windows/Linux) and Cmd+Alt+M (macOS) to open the preview.
- Added `richMarkdownPreview.openPreviewToSide`; disable it to open or reveal the preview as a tab in the current editor group without creating a split.

## 1.0.0 — 2026-10-07

- Introduced Rich Markdown Preview branding and a new extension icon.
- Set the Marketplace package ID to `rich-markdown-preview` and resolved README assets against the repository's `master` branch.
- Renamed the editor, Explorer, and Command Palette action to **Open in Rich Markdown Preview**.
- Renamed settings, the preview command, and the webview type to `richMarkdownPreview`; existing `markdownLens` and `styledMarkdown` settings and keybindings remain compatible.
- Included eighteen reading styles, light/dark/automatic appearance, live previews, heading navigation, syntax highlighting, and local Mermaid diagrams.
- Included searchable, sortable tables with spacing controls, CSV copy, and CSV export.
- Added customer documentation, preview screenshots, and expanded release regression checks.
- Fixed Mermaid theme refresh when VS Code changes appearance and accurate code-copy feedback.
