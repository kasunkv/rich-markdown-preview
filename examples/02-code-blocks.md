# Code blocks

**Expected:** recognized languages are highlighted; other code remains readable. Copy should preserve literal text, indentation, and trailing newlines.

## TypeScript

```typescript
interface PreviewSettings {
  style: 'documentation' | 'reading' | 'technical';
  width: number;
}

const settings: PreviewSettings = { style: 'reading', width: 900 };
console.log(`Selected ${settings.style}, width ${settings.width}px`);
```

## Python

```python
from dataclasses import dataclass

@dataclass
class Document:
    title: str
    sections: list[str]

def summarize(document: Document) -> str:
    # Unicode should survive copying.
    return f"{document.title}: {len(document.sections)} sections 🚀"
```

## HTML, CSS, and JSON

```html
<article class="document">
  <h1>Readable &amp; accessible</h1>
  <p data-note="quoted">This is source code, not rendered HTML.</p>
</article>
```

```css
.document {
  max-width: 900px;
  margin: 0 auto;
  color: #253247;
}
```

```json
{
  "style": "documentation",
  "appearance": "auto",
  "width": 900,
  "wrapCode": false,
  "labels": ["日本語", "සිංහල", "🚀"]
}
```

## SQL and shell

```sql
SELECT style, COUNT(*) AS previews
FROM documents
WHERE width BETWEEN 480 AND 1600
GROUP BY style;
```

```bash
# These are display fixtures, not instructions to run commands.
printf '%s\n' 'Hello, Markdown'
```

## Unknown language and no language

```made-up-language
<tag attribute="value">Escape me & keep me readable</tag>
```

```
Plain text with no language label.
Characters: < > & " ' ` $ { } [ ]
```

## Tilde fence

~~~text
Fences can use tildes as well as backticks.
~~~

## Fence containing another fence

````markdown
# Example source

```javascript
const answer = 42;
```
````

## Indented code

    Indented code is rendered as a plain code block.
    It currently does not receive the fenced-block copy toolbar.

## Long lines

Toggle **Wrap code** and compare scrolling to wrapping.

```text
https://example.com/reports/markdown-preview/very-long-path/with-many-segments/and-more-segments?style=documentation&appearance=dark&width=1600&fontSize=24&lineHeight=2.2&wrapCode=true
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789
```

## Empty fence

```text
```

## Safe code display

```javascript
// The preview must display this code, never execute it.
alert('This must not run');
document.body.innerHTML = '<h1>This must not replace the preview</h1>';
```
