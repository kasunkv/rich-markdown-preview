# Rich Markdown Preview

**A Styled Markdown Preview for Visual Studio Code** · by **Kasun Kodagoda**

Turn Markdown into a comfortable reading experience in VS Code. Rich Markdown Preview combines **18 reading styles**, live Markdown preview, syntax highlighting, **Mermaid diagrams**, and interactive tables. Use it for READMEs, documentation, technical notes, articles, and research.

## What's new in v2.0.0

- **Documentation Home:** Browse Markdown throughout your workspace in one preview tab, with an expandable folder tree and filename filtering.
- **One-click access:** Open Documentation Home from the **Rich Markdown Documentation** status bar button or our logo in the Explorer title bar.
- **Nested and hidden documentation:** Discover files in folders such as `docs/`, `reports/`, and `.claude/`, with configurable exclusions and automatic refresh.
- **Connected reading:** Follow Markdown links in place, use Back/Forward navigation, open source files for editing, and retain each document's scroll position and table filters.

[View full release notes](CHANGELOG.md)

![Rich Markdown Preview in Editorial style with light appearance](docs/rich-markdown-preview-light.png)

## Get started

1. Install **Rich Markdown Preview - A Styled Markdown Preview** from the VS Code Extensions view. Requires VS Code **1.95 or newer**.
2. Open a Markdown file (`.md`).
3. Right-click in the editor and choose **Open in Rich Markdown Preview**. The preview opens beside your source by default. Disable **Rich Markdown Preview: Open Preview To Side** in Settings to open a new tab in the current editor group.
4. Choose a **Style** and **Appearance** in the preview toolbar. Edit your Markdown to see live updates.

You can also right-click a Markdown file in **Explorer**, use the **Open in Rich Markdown Preview** action in the editor title bar, or open the **Command Palette** (`Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS) and run **Open in Rich Markdown Preview**. Press **Ctrl+Alt+M** on Windows/Linux or **Cmd+Alt+M** on macOS to open the preview from the editor. Customize this in VS Code Keyboard Shortcuts by searching for **Open in Rich Markdown Preview**. Opening the same file again brings its existing preview into view using your current placement setting. All `.md` files (including `.MD`) work even when another language is selected in the language picker.

## Features

- **18 styles:** Documentation, Reading, Technical, GitHub, Editorial, Book, Minimal, Academic, Swiss, Aurora, Botanical, Noir, Blueprint, Terracotta, Atelier, Ocean, Manuscript, and Circuit.
- **Documentation Home:** Browse Markdown across your workspace in one tab, with an expandable folder tree, filename filtering, and previews that open in place.
- **Light, dark, or automatic appearance:** Auto follows the VS Code theme, including diagram colors.
- **Reading controls:** Adjust content width, text size, and line spacing; wrap long code lines; show or hide the heading outline.
- **Frontmatter:** YAML metadata appears in a collapsible card above the document, with readable fields, nested values, and a YAML source view.
- **Preview placement:** Open beside the source or as a new tab in the current editor group.
- **Keyboard shortcut:** Ctrl+Alt+M on Windows/Linux or Cmd+Alt+M on macOS.
- **Live preview:** Updates while typing and keeps the preview's scroll position.
- **Code highlighting:** Language labels, readable syntax colors, and a Copy button on fenced code blocks.
- **Mermaid diagrams and charts:** Rendered locally with colors coordinated to your reading style.
- **Interactive tables:** Sort columns, search rows, choose spacing, and copy or export the visible data as CSV.
- **Heading navigation:** Jump to sections using the outline or heading links. Outline labels include image alt text and provide a readable fallback for headings without accessible text.
- **Extended Markdown:** Task lists, emoji shortcodes, footnotes, definition lists, highlighted text, subscript, superscript, and GitHub-style callouts.
- **File references:** Click includes, imports, embeds, and Markdown file links to open their source in VS Code. Relationship icons and syntax tooltips make dependencies easy to identify.
- **Links and images:** Local file links open in VS Code. Relative images load from the document directory; HTTPS images are supported.
- **Cross-document headings:** In a single-file preview, `guide.md#details` opens Markdown source and selects/reveals its heading. Documentation Home follows workspace Markdown links in place with the same heading intent. Links back to the current file stay in its preview. Heading aliases use the outline's lowercase Unicode slug and duplicate suffixes (`details`, `details-1`); percent-encoded Unicode is supported. File queries are ignored for local navigation, while encoded `?` and `#` remain filename characters.
- **Unresolved fragments:** Missing or malformed heading fragments leave the document open without a heading selection and show an explanation. Non-Markdown files open normally and report that heading navigation is unsupported. DocFX line fragments (`#L1`, `#L1-L3`, `#L1-3`) are unsupported: open source and use **Go to Line**. Same-document invalid fragments announce the limitation in the preview. Executable URI schemes, including `command:` and `exec:`, cannot run through preview links.
- **Offline rendering:** Styles, syntax highlighting, and Mermaid are bundled. No CDN or account is needed. Remote images and external links use your network connection.

![Rich Markdown Preview in Ocean style with dark appearance](docs/rich-markdown-preview-dark.png)

## Browse workspace documentation

Open a folder or workspace, then click **Rich Markdown Documentation** in the VS Code status bar or the **Rich Markdown Preview logo** in the Explorer title bar. The status bar uses a Markdown glyph; the Explorer button uses the extension's image icon. You can also run **Rich Markdown Preview: Open Documentation Home** from the Command Palette. No Markdown editor needs to be open.

Documentation Home opens in the current editor group. Its home page lists the workspace's documentation folders and root Markdown files, with a **Read README** shortcut when available. Each workspace folder has its own root. Expand the left-hand folder tree or filter by filename or folder path, then select a document to read it on the right.

- **Documents / On this page:** Switch between the file tree and the selected document's heading outline. **Navigation** hides or shows the sidebar; on narrow tabs it appears above the document.
- **Home, Back, Forward:** Navigate within the same preview tab. Each document keeps its table filters and reading position while you browse.
- **Open source:** Open the selected Markdown source beside Documentation Home for editing. The preview updates while you type.
- **Markdown links:** Links and file references to Markdown inside the workspace open in Documentation Home, including heading fragments. Other local files open in VS Code; external links open in your browser.
- **Refresh:** Rescan manually. File additions, deletions, and workspace-folder changes also refresh the tree automatically. If the selected file is deleted or its workspace folder is removed, the view returns home.

Discovery includes nested and hidden documentation folders such as `docs/`, `reports/`, and `.claude/`. It uses its own include/exclude settings rather than the Explorer's exclusions or `.gitignore`. Common dependency and build folders are excluded by default. Only paths are indexed; document content is read when selected. Nothing is generated or written into your repository.

| Setting | Default / behavior |
| --- | --- |
| `richMarkdownPreview.documentation.include` | `**/*.{md,MD,markdown,MARKDOWN}`; workspace-relative glob, configurable per workspace folder |
| `richMarkdownPreview.documentation.exclude` | `**/{.git,node_modules,bower_components,dist,build,out,coverage,.next,.venv,venv}/**`; set empty to remove exclusions |
| `richMarkdownPreview.documentation.showStatusBar` | `true`; disable to hide the status bar button |

Use VS Code's Find while a preview is active to search rendered document text. Documentation Home's **Filter documentation files or folders** searches paths separately. Filtered-out table rows are excluded from Find, while visible diagram source remains searchable.

Filtering searches file paths, not document contents. Files in excluded folders can still be opened through a document link, but do not appear in the tree. VS Code's filesystem watcher exclusions can prevent automatic updates in some folders; use **Refresh** to rescan them.

## Restore after a window reload

Single-file previews and Documentation Home restore their current workspace document, recent reading position, table settings and disclosures after **Developer: Reload Window**. Documentation Home retains up to 20 nearby document visits for Back/Forward navigation. Reading and session context share a 64 KiB saved-state limit, so older detail can be discarded.

Restoration checks the current workspace roots, provider availability and access policy again. Deleted or renamed files, removed workspace roots, unsupported old state, and unavailable or restricted providers show a recovery message. Standalone previews outside the current workspace require reopening the source with **Open in Rich Markdown Preview**; saved paths cannot authorize access to another folder. Local workspace previews remain available in Restricted Mode under its existing containment policy. External-image permissions continue to come from VS Code user storage.

## Make it yours

Use the toolbar to change **Style**, **Appearance**, **Width**, **Text**, **Spacing**, and **Wrap code**. The **Outline** button toggles section navigation. Drag the Width slider or enter an exact value; the slider and pixel readout stay in sync and save when you commit the value. Text size and line spacing accept any value within their displayed ranges.

Reading preferences save for the file's workspace folder, or globally for standalone files. If a settings file cannot be saved, the preview keeps your selection until navigation starts a new document session and shows a warning.

Open **View > Output** and select **Rich Markdown Preview** to see operation diagnostics and retry guidance. Diagnostics omit document text, clipboard/CSV data and provider error details.

You can also search for **Rich Markdown Preview** in VS Code Settings. The settings use the `richMarkdownPreview.*` namespace:

| Setting | Default | Options |
| --- | --- | --- |
| `richMarkdownPreview.style` | `documentation` | Any of the 18 styles |
| `richMarkdownPreview.appearance` | `auto` | `auto`, `light`, `dark` |
| `richMarkdownPreview.contentWidth` | `900` | 480–1600 pixels |
| `richMarkdownPreview.fontSize` | `16` | 12–24 pixels |
| `richMarkdownPreview.lineHeight` | `1.7` | 1.3–2.2 |
| `richMarkdownPreview.referenceRoot` | Empty | Root for `/` references; workspace-relative directory or absolute Windows path |
| `richMarkdownPreview.openPreviewToSide` | `true` | Set `false` for a new tab in the current editor group |
| `richMarkdownPreview.wrapCode` | `false` | `true` or `false` |

The placement setting applies when you next open or reveal a preview. Opening in the current group uses its available width without creating a split; existing editor groups keep their layout. The Width control still sets the maximum reading width.

All styles use system fonts; their exact appearance can vary by operating system.

## Navigate file references

References show an icon before the link: **↳ include**, **⇥ import**, **▣ embed**, or **↗ related file**. Hover to see the target and syntax; click or press Enter on the focused link to open the file in VS Code.

| Syntax | Example |
| --- | --- |
| Include directive | `{{include: /snippets/guide.md}}` |
| Claude import | `@references/guide.md` or `@"references/My Guide.md"` |
| DocFX include | `[!INCLUDE [Guide](references/guide.md)]` |
| DocFX code reference | `[!code-js[Example](scripts/example.js#L1-L5)]` |
| PyMdown snippet | `--8<-- "snippets/guide.md"` (single-line and multiline forms) |
| Jekyll | `{% include guide.md %}` or `{% include_relative guide.md %}` |
| Retype | `{{ include "snippets/guide" }}` |
| Obsidian link / embed | `[[Guide\|Read guide]]` or `![[Guide]]` |
| Include comment | `<!-- @include: snippets/guide.md -->` |
| Markdown Include | `{!! snippets/guide.md !!}` |
| Docsify | `[Guide](snippets/guide.md ":include")` |
| Markdown link | `[Guide](references/guide.md)` |

Relative targets use the current document directory. Targets starting with `/` use the document's workspace folder, or its directory for standalone files. Set **Rich Markdown Preview: Reference Root** to point at a skill package or another base directory. For a `SKILL.md` in `.claude/skills/my-skill`, set it to `.claude/skills/my-skill` when `/snippets/...` refers to that skill's snippets folder. For trusted file documents, `~/...` uses the extension host home directory; absolute Windows paths require a Windows extension host. Provider documents reject host absolute/home paths with instructions to use relative paths. A leading `/` remains Reference Root-relative on every host, including POSIX.

Jekyll includes use `_includes` under the reference root; `include_relative` uses the document directory. Retype checks the document directory, its `_includes`, and the root's `_includes`, with optional `.md`. Obsidian targets try the document directory and reference root, with optional `.md`.

Includes and embeds are shown as references rather than expanded content. Line ranges and heading fragments open the containing file. Remote include references open in your browser on click. Template variables stay literal; code examples, frontmatter values, and ordinary `@mentions` are not converted. Missing files show a warning. This supports the listed reference forms, rather than executing each tool's template engine.

## Work with tables

- Click a header to cycle through **ascending**, **descending**, and **original order**. Numbers sort numerically, text sorts naturally, and blank cells stay last.
- Type in **Search** to filter rows across every column. **Reset** clears search and restores source order.
- Choose **Comfortable** or **Compact** spacing separately for each table.
- Long tables have sticky headers. Wide tables scroll horizontally; focus the table region to scroll with the keyboard.
- **Copy CSV** and **Export CSV** include the header and currently visible rows in their current order. Export uses VS Code's Save dialog and UTF-8 with a BOM. Formula-like text is escaped for spreadsheet applications. Copy and CSV operations support up to 4,194,304 UTF-16 code units (about four million characters); filter large tables to fewer rows before exporting. CSV supports up to 100,000 rows, 1,000 columns and 1,000,000 total cells. The host validates the CSV and reapplies formula escaping before writing or copying it.

Table search, sort, and spacing survive live updates when the table's position and column headers stay the same.

## Read frontmatter

A YAML block fenced with `---` at the very start of a file is shown as **Frontmatter** above the Markdown body. This works for AI agent `SKILL.md` files and article metadata:

```markdown
---
name: article-helper
description: Helps draft and review articles.
tags: [writing, editing]
---
# Instructions

Review the article for clarity.
```

Fields start expanded. Click **Frontmatter** to collapse them, or **View YAML source** to inspect the original metadata. Lists, nested fields, and multiline descriptions are supported; metadata stays out of the heading outline. Invalid or unsupported YAML displays its source with an explanation while the body renders normally. Frontmatter must be at the start of the file and have a closing `---` or `...` line.

## Write rich Markdown

Add a Mermaid diagram using a fenced block:

````markdown
```mermaid
flowchart LR
  Write --> Preview --> Refine
```
````

Task lists (`- [ ]` and `- [x]`) display read-only checkboxes. Change their state in the source. Emoji such as `:rocket:` and `:white_check_mark:` work in prose; code keeps its literal text.

Use `==highlighted text==`, `H~2~O`, `x^2^`, and footnotes (`[^note]`). For a callout:

```markdown
> [!TIP]
> Choose Reading or Book for longer articles.
```

Supported callouts: **Note**, **Tip**, **Important**, **Warning**, and **Caution**. Raw HTML is shown as text; scripts in Markdown are not executed.

## Current limits

Saved reading state retains the active document and up to 24 recent document positions within a 64 KiB budget. Each document retains up to 24 table states and 64 disclosures; Documentation Home retains up to 128 directory expansion entries and 512 characters of filter text. Older detail is discarded as the budget fills. Scroll saves settle after 200 ms of quiet, with a one-second maximum delay, and flush before navigation or when the preview hides. Malformed or unsupported saved formats fall back to empty state.
The preview scrolls independently of the source editor. Full-document PDF/HTML export, math typesetting, custom CSS, and editable task checkboxes are not available in this release. CSV table export is supported for file workspaces. Local images stay within the document workspace folder, or its directory for standalone documents. Preview panels must be reopened after restarting VS Code. Documents are limited to 2,000,000 UTF-16 code units, 25,000 source lines, 100,000 Markdown tokens, 5,000 total table rows (including headers), and 20 Mermaid diagrams. Individual diagrams permit 20,000 code units and 500 edges. Syntax highlighting permits 20,000 code units per block and 80,000 per document; larger blocks retain their complete escaped text with an explanation. Provider images are deduplicated and authorize at most 128 distinct local sources with four physical reads shared across revisions and at most 64 path segments. A provider that takes longer than two seconds leaves the document readable with a status message; timed-out reads retain their slots until they settle, and the preview retries when capacity returns. Hidden panels suspend rendering, and unchanged view events reuse the current model. Render and diagram caches stay in memory, have fixed bounds, and are cleared when resource or image-permission policy changes. Rendered content must also fit the validated message contract: at most 100,000 outline/reference entries, 8,192 code units per outline field and 33,554,432 UTF-16 code units of HTML. A document that expands beyond these limits shows an actionable message; open its source or split it into smaller documents. Oversized diagrams show a diagram error. Diagram security settings cannot be weakened by document configuration directives. Authored internal preview-resource URLs and ambiguous URL escapes in diagrams are unsupported; use ordinary Markdown images, data images, or an explicitly allowed HTTPS origin instead. IPv6 image hosts are unsupported by Chromium CSP and display an explanation without an Allow button. Cached SVG output must use self-contained references and styles scoped to its own root. Global CSS, cross-diagram fragment resources, escaped resource styles and unsupported CSS at-rules recover to the accessible diagram source. Animation names are isolated per instance. These ceilings bound supported input and output; complex diagrams can still take longer to render.

## License

Rich Markdown Preview is available under the [MIT License](LICENSE).

[Developer documentation and release instructions](DEVELOPMENT.md)

### Local images

Both single-file previews and Documentation Home can load images inside the document’s active workspace folder, including sibling paths such as `../assets/diagram.svg`. Standalone documents can load images only from their own directory. Spaces and encoded filename characters are supported; URL queries and fragments remain separate from the file path. Missing images, traversal outside the allowed root, and symlinks that escape its canonical directory are blocked. Local images from remote or virtual filesystem providers are currently blocked; provider support is tracked separately.

### Accessible reading

VS Code high-contrast dark and light themes override the reading palette, including an explicit Light/Dark preview preference, so the editor's accessibility colors and focus border remain visible. Every Mermaid figure retains a keyboard-accessible **Diagram source** disclosure after rendering. Use Mermaid `accTitle` and `accDescr` to supply a descriptive diagram title and explanation; source remains available when a diagram has no authored description or cannot render. Tables retain column headers, keyboard sorting, and polite row-count announcements. The outline remains available in narrow reading layouts. Selecting an outline entry or document fragment moves keyboard focus to that content, and live refresh preserves the reading target.

Automated contrast, axe, keyboard, reflow and reduced-motion checks complement manual screen-reader testing. The latter requires a representative VS Code installation and assistive technology; automated checks do not establish screen-reader usability by themselves.

### External image privacy

Remote Markdown images are blocked by default in single-file previews and Documentation Home. Use **Allow images from https://…** beside a blocked image, then confirm in VS Code, to allow that exact HTTPS origin. Images use a `no-referrer` policy. HTTP, protocol-relative URLs, credentials, and malformed remote URLs cannot be granted. Local images continue to follow the local resource policy.

Grants belong to your VS Code extension storage, apply across documents, and are never read from workspace settings. Use **Block images from https://…** beside an allowed image to revoke its origin. Permission changes refresh open previews and their CSP; grants for a different scheme, host, or port do not match. Opening external links remains an explicit user action; reference/include syntax does not download remote content.

This replaces the previous automatic HTTPS image loading default. Existing documents may show blocked-image actions until you explicitly grant their origins.

### Restricted Mode

Local workspace Markdown, local images, and Documentation Home remain available in Restricted Mode. Navigation stays inside the workspace; absolute filesystem/home references, outside files, and symlink escapes are blocked. The referenceRoot setting is ignored until the workspace is trusted.

Remote images are disabled even for previously approved origins. Granting workspace trust enables navigation and image controls; saved image origins remain suspended until you explicitly allow each origin again. Trust alone does not load remote images.

### Remote and provider workspaces

The extension runs in the workspace Node extension host on desktop VS Code and Node-based remote hosts. It has no browser/vscode.dev entrypoint. Trusted provider documents retain their URI scheme and authority for relative references and images. Images use VS Code webview resource authorization, logical workspace containment, and rejection of provider-reported symlink ancestry; opaque providers define their namespace and do not expose a generic canonical disk path. Provider access is blocked in Restricted Mode.

Documentation Home uses bounded provider directory traversal with case-sensitive include/exclude globs, including hidden Markdown. Excluded folders and reported symlinks are skipped. Each provider root permits at most 20,000 entries, 5,000 Markdown results and 64 directory levels; narrow the documentation include/exclude settings if discovery reaches a limit. File and remote search providers retain VS Code search.

CSV export is unavailable from provider documents; use Copy CSV and save in a writable host folder. On a Node remote host, file export uses that host's native Save dialog and filesystem; it is not an automatic download to the desktop. Actual SSH/WSL infrastructure validation remains pending a supplied development workspace; the tested custom read-only provider does not establish that infrastructure smoke.
