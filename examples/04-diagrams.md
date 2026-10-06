# Mermaid diagrams

**Expected:** valid diagrams render locally. Switching Light/Dark recolors diagrams. Width and typography changes should not recreate diagrams. The final diagram is intentionally invalid.

## Flowchart

```mermaid
flowchart TD
  A[Open Markdown] --> B{Choose style}
  B -->|Article| C[Reading]
  B -->|Reference| D[Technical]
  B -->|Guide| E[Documentation]
  C --> F[Read preview]
  D --> F
  E --> F
```

## Sequence diagram

```mermaid
sequenceDiagram
  participant User
  participant Preview
  participant Settings
  User->>Preview: Change appearance
  Preview-->>User: Apply immediately
  Preview->>Settings: Save preference
  alt Save succeeds
    Settings-->>Preview: Saved
  else Settings are read-only
    Settings-->>Preview: Error
    Preview-->>User: Keep live appearance
  end
```

## Class diagram

```mermaid
classDiagram
  class Preview {
    +String style
    +Number width
    +render()
  }
  class Document {
    +String source
    +parse()
  }
  Preview --> Document : displays
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Rendering: open
  Rendering --> Ready: success
  Rendering --> Error: invalid diagram
  Error --> Rendering: edit
  Ready --> Rendering: content change
  Ready --> [*]: close
```

## Entity relationship diagram

```mermaid
erDiagram
  DOCUMENT ||--o{ SECTION : contains
  SECTION ||--o{ CODE_BLOCK : includes
  DOCUMENT {
    string title
    string path
  }
  SECTION {
    string heading
    int level
  }
  CODE_BLOCK {
    string language
    string source
  }
```

## Gantt chart

```mermaid
gantt
  title Example development schedule
  dateFormat YYYY-MM-DD
  section Preview
  Renderer :done, renderer, 2026-10-01, 3d
  Styles :active, styles, after renderer, 3d
  Validation :validation, after styles, 2d
```

## Pie chart

```mermaid
pie title Example document content
  "Prose" : 50
  "Code" : 30
  "Diagrams" : 20
```

## Mind map

```mermaid
mindmap
  root((Markdown Preview))
    Reading
      Typography
      Width
    Development
      Code
      Diagrams
    Navigation
      Outline
      Links
```

## User journey

```mermaid
journey
  title Reading a technical document
  section Open
    Find file: 4: Reader
    Open preview: 5: Reader
  section Read
    Choose style: 5: Reader
    Review diagram: 5: Reader
```

## Intentional invalid syntax

```mermaid
flowchart TD
  A[An unclosed node
  A -->
```

## Content after the error

This heading and paragraph should still render. The invalid diagram should show its source and an error message.
