import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { full as emoji } from 'markdown-it-emoji';
import taskLists from 'markdown-it-task-lists';
import footnotes from 'markdown-it-footnote';
import definitionLists from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import subscript from 'markdown-it-sub';
import superscript from 'markdown-it-sup';
import { renderFrontmatter } from './frontmatter';
import { externalImageDecision } from './external-images';
import { installReferences, type FileReference } from './references';

export interface OutlineItem {
  id: string;
  fragment: string;
  text: string;
  level: number;
  sourceLine: number;
}

function extractHeadingText(tokens: NonNullable<MarkdownIt.Token['children']>): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline' || token.type === 'emoji') return token.content;
      if (token.type === 'file_reference') return token.meta?.label ?? token.content;
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
      if (token.type === 'image') {
        const alt = token.children?.length ? extractHeadingText(token.children) : token.content;
        return alt;
      }
      return token.children?.length ? extractHeadingText(token.children) : '';
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function renderMarkdown(
  source: string,
  imageUri: (src: string) => string = (src) => src,
  externalImages: { grants?: ReadonlySet<string>; enabled?: boolean } = {},
) {
  const externalImageOrigins = new Set<string>();
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const references: FileReference[] = [];
  installReferences(md, references);
  md.use(emoji, { shortcuts: {} })
    .use(taskLists, { enabled: false, label: true })
    .use(footnotes)
    .use(definitionLists)
    .use(mark)
    .use(subscript)
    .use(superscript);
  // Keep plugin-generated footnote links and IDs in a separate namespace.
  for (const rule of ['footnote_ref', 'footnote_open', 'footnote_anchor']) {
    const render = md.renderer.rules[rule]!;
    md.renderer.rules[rule] = (tokens, index, options, env, renderer) =>
      render(tokens, index, options, env, renderer)
        .replace(/id="(fn[^"]+)"/g, 'id="rmp-footnote-$1" data-md-anchor="$1"')
        .replace(/href="#(fn[^"]+)"/g, 'href="#rmp-footnote-$1"');
  }
  md.renderer.rules.emoji = (tokens, index) =>
    `<span class="emoji" role="img" aria-label="${md.utils.escapeHtml(tokens[index].markup.replace(/_/g, ' '))}">${md.utils.escapeHtml(tokens[index].content)}</span>`;
  md.renderer.rules.table_open = (tokens, index, options, env, renderer) =>
    '<div class="table-scroll" role="region" aria-label="Table; scroll horizontally to view more columns" tabindex="0">' +
    renderer.renderToken(tokens, index, options);
  md.renderer.rules.table_close = (tokens, index, options, env, renderer) =>
    renderer.renderToken(tokens, index, options) + '</div>\n';
  md.renderer.rules.th_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('scope', 'col');
    return renderer.renderToken(tokens, index, options);
  };
  const callouts: Record<string, { label: string; icon: string }> = {
    NOTE: { label: 'Note', icon: 'ⓘ' },
    TIP: { label: 'Tip', icon: '✦' },
    IMPORTANT: { label: 'Important', icon: '◆' },
    WARNING: { label: 'Warning', icon: '⚠' },
    CAUTION: { label: 'Caution', icon: '!' },
  };
  md.core.ruler.after('inline', 'preview-callouts', (state) => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const opening = state.tokens[i];
      const inline = state.tokens[i + 2];
      if (
        opening.type !== 'blockquote_open' ||
        state.tokens[i + 1].type !== 'paragraph_open' ||
        inline.type !== 'inline'
      )
        continue;
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
    return (
      renderer.renderToken(tokens, index, options) +
      (title ? `<p class="markdown-alert-title"><span aria-hidden="true">${title.icon}</span> ${title.label}</p>` : '')
    );
  };
  const frontmatter = renderFrontmatter(source, md.utils.escapeHtml);
  const sourceOffset = source.slice(0, source.length - frontmatter.body.length).split('\n').length - 1;
  const outline: OutlineItem[] = [];
  const ids = new Map<string, number>();
  const usedIds = new Set<string>();
  md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
    const inline = tokens[index + 1];
    const text = extractHeadingText(inline.children ?? []);
    const label = text || 'Untitled section';
    const base =
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    let count = ids.get(base) ?? 0;
    let id = count ? `${base}-${count}` : base;
    while (usedIds.has(id)) {
      count++;
      id = `${base}-${count}`;
    }
    ids.set(base, count + 1);
    usedIds.add(id);
    tokens[index].attrSet('id', 'rmp-heading-' + id);
    tokens[index].attrSet('data-md-anchor', id);
    outline.push({
      id: 'rmp-heading-' + id,
      fragment: id,
      text: label,
      level: Number(tokens[index].tag.slice(1)),
      sourceLine: sourceOffset + tokens[index].map![0],
    });
    return renderer.renderToken(tokens, index, options);
  };
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const src = tokens[index].attrGet('src') ?? '';
    const decision = externalImageDecision(src, externalImages.grants ?? new Set(), externalImages.enabled);
    if (decision.kind !== 'local' && decision.origin) externalImageOrigins.add(decision.origin);
    if (decision.kind === 'blocked') {
      const alt = md.utils.escapeHtml(
        extractHeadingText(tokens[index].children ?? []) || tokens[index].content || 'Image',
      );
      const action = decision.origin
        ? `<button type="button" class="external-image-action" data-external-image-action="grant" data-external-image-origin="${md.utils.escapeHtml(decision.origin)}">Allow images from ${md.utils.escapeHtml(decision.origin)}</button>`
        : '<span>Only valid HTTPS image origins can be allowed.</span>';
      return `<span class="external-image-blocked">${alt}: external image blocked. ${action}</span>`;
    }
    tokens[index].attrSet('src', decision.kind === 'allowed' ? decision.source : imageUri(src));
    tokens[index].attrSet('referrerpolicy', 'no-referrer');
    tokens[index].attrSet('loading', 'lazy');
    const html = image(tokens, index, options, env, renderer);
    return decision.kind === 'allowed'
      ? `${html}<button type="button" class="external-image-action" data-external-image-action="revoke" data-external-image-origin="${md.utils.escapeHtml(decision.origin)}">Block images from ${md.utils.escapeHtml(decision.origin)}</button>`
      : html;
  };
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid')
      return `<figure class="diagram"><div class="diagram-label">Mermaid diagram</div><pre class="mermaid-source">${md.utils.escapeHtml(token.content)}</pre></figure>`;
    const code =
      language && hljs.getLanguage(language)
        ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value
        : md.utils.escapeHtml(token.content);
    return `<div class="code-block"><div class="code-toolbar"><span>${md.utils.escapeHtml(language || 'plain text')}</span><button class="copy-code" type="button" aria-label="Copy code">Copy</button></div><pre><code class="hljs">${code}</code></pre></div>`;
  };
  return {
    html: frontmatter.html + md.render(frontmatter.body),
    outline,
    references,
    externalImageOrigins: [...externalImageOrigins],
  };
}
