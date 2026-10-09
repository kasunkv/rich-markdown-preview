import { parseDocument } from 'yaml';

// Only a fenced YAML block at the beginning of the file is frontmatter.
export function renderFrontmatter(source: string, escape: (text: string) => string) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source);
  if (!match || match.index !== 0) return { html: '', body: source };
  const raw = match[1];
  const body = source.slice(match[0].length);
  const sourceView = `<pre class="frontmatter-source"><code>${escape(raw)}</code></pre>`;
  let fields: string;
  try {
    const document = parseDocument(raw, { schema: 'core' });
    if (document.errors.length || document.warnings.length) throw new Error('Invalid or unsupported YAML');
    const metadata: unknown = document.toJS({ maxAliasCount: 20 });
    if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('Expected YAML fields');
    let remaining = 500;
    const ancestors = new Set<object>();
    const value = (item: unknown, depth = 0): string => {
      if (--remaining < 0 || depth > 12) return '<span class="frontmatter-muted">More values in YAML source</span>';
      if (item === null || item === undefined) return '<span class="frontmatter-muted">null</span>';
      if (typeof item !== 'object') return `<span class="frontmatter-value">${escape(String(item))}</span>`;
      if (ancestors.has(item)) return '<span class="frontmatter-muted">Alias reference (see YAML source)</span>';
      ancestors.add(item);
      let rendered: string;
      if (Array.isArray(item)) {
        rendered = item.length ? `<ul class="frontmatter-list">${item.slice(0, 500).map(entry => `<li>${value(entry, depth + 1)}</li>`).join('')}</ul>` : '<span class="frontmatter-muted">[]</span>';
      } else {
        const entries = Object.entries(item);
        rendered = entries.length ? `<dl class="frontmatter-fields">${entries.slice(0, 500).map(([key, entry]) => `<div class="frontmatter-field"><dt>${escape(key)}</dt><dd>${value(entry, depth + 1)}</dd></div>`).join('')}</dl>` : '<span class="frontmatter-muted">{}</span>';
      }
      ancestors.delete(item);
      return rendered;
    };
    fields = metadata === null ? '<p class="frontmatter-muted">No metadata fields.</p>' : value(metadata);
    fields += `<details class="frontmatter-raw"><summary>View YAML source</summary>${sourceView}</details>`;
  } catch {
    fields = `<p class="frontmatter-muted">Could not read frontmatter fields. Check the YAML source below.</p>${sourceView}`;
  }
  return { html: `<details class="frontmatter" open><summary>Frontmatter <span>Document metadata</span></summary><div class="frontmatter-content">${fields}</div></details>\n`, body };
}
