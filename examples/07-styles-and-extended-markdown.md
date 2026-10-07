# Make room for good ideas :sparkles:

One document, eight ways to read. Try **GitHub** for familiar documentation, **Editorial** for bold headlines, **Book** for warm serif reading, **Minimal** for quiet notes, and **Academic** for formal reports.

Good typography helps you follow an idea from its first sentence to its last. Change the style without losing your place, then adjust width and spacing to suit your screen. Every preset has both light and dark colors and uses fonts available locally.

## A small checklist :white_check_mark:

- [x] Render completed tasks with a real checkbox
- [ ] Keep pending tasks easy to spot
  - [X] Preserve nested checked tasks
  - [ ] Render **bold labels** and :rocket: emoji
- This is an ordinary bullet, not a task.

> [!TIP]
> ==Pick a comfortable width== before reading a long document. These checkboxes reflect the source; edit `[ ]` or `[x]` in Markdown to change them.

## Expressive details

Status: :rocket: :smile: :warning: :heart: :+1: :tada: :white_check_mark:.

Native emoji still work: 👩‍💻 🌍 🚀. Unknown shortcode: :not_a_real_emoji:.

Inline source stays literal: `:rocket:` and `- [ ] Task`.

## Notes and terminology

The preview renders common extensions alongside ordinary Markdown.[^extensions]

Typography
: The arrangement of text to make a document readable.

Reading width
: The maximum width of the document, controlled by the preview toolbar.

Chemistry: H~2~O. Algebra: x^2^ + y^2^ = z^2^.

| Style | Typography | Best for |
| --- | --- | --- |
| GitHub | System sans-serif | READMEs :page_facing_up: |
| Editorial | Serif prose, bold sans headings | Articles :newspaper: |
| Book | Classic Palatino-style serif | Essays :books: |
| Minimal | Quiet sans-serif | Focused notes :memo: |
| Academic | Cambria-style serif | Research :microscope: |

## Helpful callouts

> [!NOTE]
> Footnotes, definition lists, and emoji work in every style.

> [!IMPORTANT]
> Style changes respect your selected font size, spacing, width, and appearance.

> [!WARNING]
> This is a rendering fixture. It is not an instruction to run code.

> [!CAUTION]
> Raw HTML remains escaped. A richer renderer should not execute document scripts.

## Code stays code

```markdown
- [ ] Literal task marker in a code block
:rocket: stays a shortcode in code
> [!NOTE]
> A literal callout example
```

## Loose task lists

- [ ] A task with a second paragraph.

  The second paragraph remains inside the list item.

- [x] A completed loose-list task with *italic text*.

  This checks checkbox alignment in a loose list.

[^extensions]: These are Markdown extensions; support varies between renderers. The extension handles them locally without a CDN.
