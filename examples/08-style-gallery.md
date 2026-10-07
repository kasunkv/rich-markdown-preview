# Typography in motion

A good reading surface gives every idea room to breathe. Switch between the eighteen styles to compare the title, section markers, body type, code frames, and diagram palettes. All fonts are local; the preview also works offline.

## A clear visual hierarchy

This is the body text: comfortable, unhurried, and easy to scan. **Strong emphasis** draws attention to a useful detail, while *italics* give a phrase a softer voice. Inline code such as `renderMarkdown(source)` keeps its transparent background.

### A supporting idea

Headings should look different from paragraphs and from one another. Some presets use expressive serif titles, others use graphic rules, small capitals, or precise monospaced section labels.

#### A practical detail

Use the text size and line spacing controls to find your preferred rhythm.

##### A smaller point

All six heading levels stay in the document outline.

###### A final annotation

> Typography is the quiet architecture of a page.

## Code with room to breathe

```typescript
interface ReadingStyle {
  name: string;
  comfortable: boolean;
}

// A small function with clearly separated syntax colors.
function chooseStyle(styles: ReadingStyle[]): string[] {
  const limit = 10;
  return styles
    .filter(style => style.comfortable)
    .slice(0, limit)
    .map(style => `Try ${style.name}`);
}
```

```json
{ "style": "ocean", "fontSize": 18, "wrapCode": true }
```

## Diagrams that belong on the page

```mermaid
flowchart LR
  A[Write Markdown] --> B{Choose a style}
  B --> C[Read comfortably]
  B --> D[Explore the diagrams]
  C --> E[Share your ideas]
  D --> E
```

```mermaid
sequenceDiagram
  participant Reader
  participant Preview
  Reader->>Preview: Choose a new style
  Preview-->>Reader: Update typography and colors
  Reader->>Preview: Switch to dark appearance
  Preview-->>Reader: Refresh diagram palette
```

## Charts in the same palette

```mermaid
pie title Reading time by topic
  "Guides" : 40
  "Examples" : 30
  "References" : 20
  "Notes" : 10
```

```mermaid
xychart-beta
  title "Weekly reading progress"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Pages" 0 --> 50
  bar [12, 24, 18, 36, 42]
  line [10, 20, 25, 30, 40]
```

## Structured information

| Style family | Example | Reading character |
| --- | --- | --- |
| Graphic | Swiss, Blueprint, Circuit | Confident rules and precise structure |
| Literary | Botanical, Terracotta, Manuscript | Graceful serif headings |
| Expressive | Aurora, Noir, Atelier | Distinct display titles |
| Airy | Ocean | Open, humanist typography |

> [!TIP]
> Compare light and dark appearance, then try a narrow preview and wrapped code. Style changes preserve your reading position.
