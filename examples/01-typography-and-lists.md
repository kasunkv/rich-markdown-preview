# Typography and lists

**Expected:** core Markdown renders. Compare all three styles, text sizes, and line spacing.

## Heading hierarchy

### Heading level three

#### Heading level four

##### Heading level five

###### Heading level six

Setext heading level one
=======================

Setext heading level two
-----------------------

## Paragraphs and inline formatting

A readable paragraph needs a comfortable line length. Resize the preview and change its maximum width. This paragraph is intentionally long enough to wrap over multiple lines on smaller screens, so you can inspect line spacing and how the text flows around inline formatting.

This is *italic*, this is _also italic_, this is **bold**, and this is __also bold__. This is ***bold italic***, **bold with an *italic phrase***, and ~~deleted text~~. Inline code: `const width = 900`.

An inline code span with a backtick: ``Use `code` inside this span``.

Soft line break follows this sentence.
This usually stays in the same paragraph.

A hard line break follows this sentence.  
This appears on a new line.

A backslash hard break follows this sentence.\
This also appears on a new line.

Escaped punctuation: \*not italic\*, \[not a link\], \# not a heading.

Entities: &amp; &lt; &gt; &quot; &copy; &#169; &#x1F680;.

Typography: "quoted text", 'single quotes', one -- two --- three... (c) (tm).

Unicode: café, naïve, 日本語, සිංහල, العربية, Ελληνικά, 🚀, ✅, 👩‍💻.

## Lists

- First bullet
- Second bullet with **emphasis**
  - Nested bullet
    - Third level
  - Another nested item
- Last bullet

* Asterisk bullet
* Another item

+ Plus bullet
+ Another item

3. Numbered list starting at three
4. Another item
   1. Nested ordered list
   2. Second nested item
5. Last item

1) Parenthesis-style numbering
2) Second item

- A loose list item with two paragraphs.

  The second paragraph belongs to this item.

- Another loose item.

  > A quotation inside a list.

  ```text
  A code block inside the same list item.
  ```

## Blockquotes

> A simple quote with **bold text** and a [link](https://example.com).
>
> A second paragraph.
>
> > A nested quote.
>
> - A quoted list
> - Another quoted item

## Horizontal rules

Above a dash rule.

---

Above an asterisk rule.

***

Above an underscore rule.

___

## Repeated heading

First occurrence.

## Repeated heading

Second occurrence. Both outline items should target their own heading.

## 日本語とසිංහල

Unicode headings should remain readable in the outline.
