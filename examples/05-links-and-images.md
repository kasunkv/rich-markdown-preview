# Links and images

**Expected:** local images load without a network connection; links open their intended target. Broken-resource tests are labeled below.

## Inline and reference links

[External example](https://example.com "External link title")

[Local file](01-typography-and-lists.md)

[Filename with spaces](assets/linked%20note.md)

[Cross-file heading](assets/linked%20note.md#link-target) — currently opens the file without scrolling to its heading.

[Reference-style link][docs]

[Collapsed reference][]

[Shortcut reference]

[docs]: https://code.visualstudio.com/docs "VS Code documentation"
[Collapsed reference]: https://example.com/collapsed
[Shortcut reference]: https://example.com/shortcut

## Autolinks and plain URLs

<https://example.com>

<reader@example.invalid>

https://example.com/a/long/path?style=reading&width=900

## Heading navigation

[Jump to the local image](#local-image)

[Jump to the Unicode heading](#日本語の画像)

## Local image

![Three panels labeled Read, Code, and Visualize](assets/preview-test.svg "Local image fixture")

## Reference image

![Reference image][fixture]

[fixture]: assets/preview-test.svg "Reference image title"

## Linked image

[![Click the image to open the linked note](assets/preview-test.svg)](assets/linked%20note.md)

## 日本語の画像

![Unicode alt text: සිංහල · 日本語 · 🚀](assets/preview-test.svg)

## Optional remote image

This test requires a network connection and the external image service to be available.

![Remote placeholder](https://placehold.co/640x200/png "Optional HTTPS image")

## Intentionally broken image

![Missing local image: inspect the broken-image/alt-text behavior](assets/intentionally-missing.png)

## Intentionally missing local file

[Missing file: expect an open-file error](assets/intentionally-missing.md)

## Unsafe links should not execute

[JavaScript URL should be rejected](javascript:alert%281%29)

[Command URL should not launch a VS Code command](command:workbench.action.closeWindow)

These are inert security fixtures. Clicking them must not execute JavaScript or commands.
