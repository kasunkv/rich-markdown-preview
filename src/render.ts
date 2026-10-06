import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

export interface OutlineItem { id: string; text: string; level: number }
export function renderMarkdown(source: string, imageUri: (src: string) => string = src => src) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const outline: OutlineItem[] = [];
  const ids = new Map<string, number>();
  const usedIds = new Set<string>();
  md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
    const inline = tokens[index + 1];
    const text = (inline.children ?? []).filter(t => t.type === 'text' || t.type === 'code_inline').map(t => t.content).join('');
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
    let count = ids.get(base) ?? 0;
    let id = count ? `${base}-${count}` : base;
    while (usedIds.has(id)) { count++; id = `${base}-${count}`; }
    ids.set(base, count + 1); usedIds.add(id);
    tokens[index].attrSet('id', id);
    outline.push({ id, text, level: Number(tokens[index].tag.slice(1)) });
    return renderer.renderToken(tokens, index, options);
  };
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const src = tokens[index].attrGet('src') ?? '';
    tokens[index].attrSet('src', imageUri(src));
    tokens[index].attrSet('loading', 'lazy');
    return image(tokens, index, options, env, renderer);
  };
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid') return `<figure class="diagram"><div class="diagram-label">Mermaid diagram</div><pre class="mermaid-source">${md.utils.escapeHtml(token.content)}</pre></figure>`;
    const code = language && hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(token.content);
    return `<div class="code-block"><div class="code-toolbar"><span>${md.utils.escapeHtml(language || 'plain text')}</span><button class="copy-code" type="button" aria-label="Copy code">Copy</button></div><pre><code class="hljs">${code}</code></pre></div>`;
  };
  return { html: md.render(source), outline };
}
