# Tables

**Expected:** headers, cell borders, row stripes, alignment, and horizontal scrolling remain readable in all styles.

## Alignment

| Left | Center | Right |
| :--- | :---: | ---: |
| Alpha | Beta | 1 |
| Longer text | Middle | 2000 |
| Final row | Centered | 3.14159 |

## Inline Markdown in cells

| Feature | Example | Notes |
| --- | --- | --- |
| Emphasis | **bold**, *italic*, ~~removed~~ | Inline formatting |
| Code | `const width = 900` | Monospace |
| Link | [Example](https://example.com) | External navigation |
| Escaped pipe | left \| right | One cell, not two |
| Code with pipe | `left \| right` | Escaped delimiter |
| Unicode | 日本語 · සිංහල · 🚀 | Font fallback |
| Empty value | | Blank middle cell |

## Wide table

| Identifier | Title | Owner | Created | Status | Environment | Notes | Reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-001 | Markdown preview styling and readability | Documentation team | 2026-10-07 | In review | Local development | This deliberately long cell tests wrapping and horizontal overflow in a narrow split editor. | `preview/documentation/readability/review/001` |
| DOC-002 | Code visualization and diagram rendering | Developer experience | 2026-10-08 | Draft | Test workspace | Check how large content widths and compact Technical styling affect this table. | `preview/technical/diagrams/review/002` |

## Minimal table

Column A | Column B
--- | ---
No outside pipes | Still a table

## Short and long rows

| A | B | C |
| --- | --- | --- |
| One | Two |
| One | Two | Three | Extra cell |

The parser fills missing cells and ignores extra cells according to its table behavior.

## Table inside a list

- Comparison:

  | Style | Audience |
  | --- | --- |
  | Reading | Articles |
  | Technical | Reference notes |

## Not a table

The next lines lack a separator row and should remain plain text.

| Name | Value |
| Width | 900 |
