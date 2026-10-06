---
title: Extended Markdown tests
tags: [preview, fixtures]
---

# Edge cases and optional extensions

The metadata block above is intentionally first. YAML front matter has no dedicated support in this version and is interpreted as ordinary Markdown.

## Task lists — optional extension

- [ ] Unchecked task
- [x] Completed task
  - [ ] Nested task

Expected now: literal bracket markers in normal lists, without interactive checkboxes.

## Footnotes — optional extension

A sentence with a footnote.[^note]

[^note]: This should become a footnote only when a footnote plugin is added.

## Definition lists — optional extension

Markdown
: A lightweight text format.

Preview
: The rendered reading view.

## Math — optional extension

Inline: $E = mc^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

```math
f(x) = x^2 + 2x + 1
```

Expected now: readable literal math, without typesetting.

## Other extended inline syntax

Emoji shortcodes: :rocket: :smile: :warning:.

Native emoji: 🚀 😄 ⚠️.

Highlight: ==highlighted text==.

Subscript: H~2~O. Superscript: x^2^.

Custom attributes: [Styled link](https://example.com){.button}.

## Admonitions — optional extensions

> [!NOTE]
> GitHub-style note syntax currently remains a blockquote with a literal marker.

> [!WARNING]
> This is a warning fixture, not a product warning.

::: tip
Colon-container syntax currently remains plain text.
:::

## Raw HTML must remain inert

<div class="custom-panel">This should be visible as literal HTML.</div>

<details>
<summary>Expandable content</summary>
This does not become an interactive details element in the current renderer.
</details>

<!-- This HTML comment is deliberately visible because raw HTML is disabled. -->

<script>alert('This must never execute')</script>

<img src="missing.png" onerror="alert('This must never execute')">

<iframe src="https://example.com"></iframe>

## Unmatched inline syntax

An unfinished *emphasis marker.

An unfinished **strong marker.

An unfinished `inline code marker.

[An incomplete link](

## Long unbroken content

abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789

## Duplicate heading

First heading.

## Duplicate heading-1

A literal suffix that could otherwise collide with a generated duplicate anchor.

## Duplicate heading

The outline should still have three unique targets.

## !!!

A punctuation-only heading uses a fallback anchor.

## Inline **bold** and `code` heading

The outline should use the visible heading text.

## Tabs, RTL, and mixed scripts

مرحبا بالعالم — العربية alongside English, 日本語, and සිංහල.

## Unclosed fence — intentionally last

Everything below the opening fence should be code, including the apparent heading. This is expected Markdown behavior.

```text
This fence is intentionally never closed.

# This should not appear in the heading outline

**This should remain plain code text.**
