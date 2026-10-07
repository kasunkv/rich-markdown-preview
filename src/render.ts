import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { full as emoji } from 'markdown-it-emoji';
import taskLists from 'markdown-it-task-lists';
import footnotes from 'markdown-it-footnote';
import definitionLists from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import subscript from 'markdown-it-sub';
import superscript from 'markdown-it-sup';

export interface OutlineItem { id: string; text: string; level: number }
export function renderMarkdown(source: string, imageUri: (src: string) => string = src => src) {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  md.use(emoji, { shortcuts: {} })
    .use(taskLists, { enabled: false, label: true })
    .use(footnotes).use(definitionLists).use(mark).use(subscript).use(superscript);
  md.renderer.rules.emoji = (tokens, index) => `<span class="emoji" role="img" aria-label="${md.utils.escapeHtml(tokens[index].markup.replace(/_/g, ' '))}">${md.utils.escapeHtml(tokens[index].content)}</span>`;
  md.renderer.rules.table_open = (tokens, index, options, env, renderer) =>
    '<div class="table-scroll" role="region" aria-label="Table; scroll horizontally to view more columns" tabindex="0">' + renderer.renderToken(tokens, index, options);
  md.renderer.rules.table_close = (tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options) + '</div>\n';
  md.renderer.rules.th_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('scope', 'col');
    return renderer.renderToken(tokens, index, options);
  };
  const callouts: Record<string, { label: string; icon: string }> = {
    NOTE: { label: 'Note', icon: 'ⓘ' }, TIP: { label: 'Tip', icon: '✦' },
    IMPORTANT: { label: 'Important', icon: '◆' }, WARNING: { label: 'Warning', icon: '⚠' }, CAUTION: { label: 'Caution', icon: '!' }
  };
  md.core.ruler.after('inline', 'preview-callouts', state => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const opening = state.tokens[i];
      const inline = state.tokens[i + 2];
      if (opening.type !== 'blockquote_open' || state.tokens[i + 1].type !== 'paragraph_open' || inline.type !== 'inline') continue;
      const children = inline.children ?? [];
      const first = children[0];
      const match = first?.type === 'text' && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.exec(first.content);
      if (!match || (children[1] && !['softbreak', 'hardbreak'].includes(children[1].type))) continue;
      opening.attrJoin('class', `markdown-alert markdown-alert-${match[1].toLowerCase()}`);
      opening.meta = { callout: match[1] };
      children.splice(0, children[1] ? 2 : 1);
    }
  });
  md.renderer.rules.blockquote_open = (tokens, index, options, env, renderer) => {
    const type = tokens[index].meta?.callout;
    const title = type ? callouts[type] : undefined;
    return renderer.renderToken(tokens, index, options) + (title ? `<p class="markdown-alert-title"><span aria-hidden="true">${title.icon}</span> ${title.label}</p>` : '');
  };
  const outline: OutlineItem[] = [];
  const ids = new Map<string, number>();
  const usedIds = new Set<string>();
  md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
    const inline = tokens[index + 1];
    const text = (inline.children ?? []).filter(t => ['text', 'code_inline', 'emoji'].includes(t.type)).map(t => t.content).join('');
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
