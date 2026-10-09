import type MarkdownIt from 'markdown-it';

export interface FileReference { id: string; path: string; syntax: string; relationship: 'include' | 'import' | 'embed' | 'link'; label: string }

export function referencePaths(reference: FileReference): string[] {
  let path = reference.path;
  if (reference.syntax === 'PyMdown') path = path.replace(/:[\w,\s:-]+$/, '');
  path = path.split('#')[0].split('?')[0];
  if (reference.syntax === 'Jekyll') return [`/_includes/${path}`];
  if (reference.syntax === 'Retype') {
    const candidates = [path, `_includes/${path}`, `/_includes/${path}`];
    return candidates.flatMap(candidate => /\.[^/]+$/.test(candidate) ? [candidate] : [candidate, `${candidate}.md`]);
  }
  if (reference.syntax === 'Obsidian') return /\.\w+$/.test(path) ? [path, `/${path}`] : [`${path}.md`, `/${path}.md`];
  return [path];
}

export function installReferences(md: MarkdownIt, references: FileReference[]) {
  const escape = md.utils.escapeHtml;
  const icons = { include: '↳', import: '⇥', embed: '▣', link: '↗' };
  const register = (path: string, syntax: string, relationship: FileReference['relationship'], label = path) => {
    const target = syntax === 'PyMdown' ? path.replace(/:[\w,\s:-]+$/, '') : path;
    // Templates are shown literally when their target cannot be resolved statically.
    if (!path || /[\u0000-\u001f<>]/.test(path) || (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) && !/^(?:https?:\/\/|[a-z]:[\\/])/i.test(target)) || /\$|\{\{|{%/.test(path)) return undefined;
    const reference = { id: `reference-${references.length}`, path, syntax, relationship, label };
    references.push(reference);
    return reference;
  };
  const anchor = (reference: FileReference) => `<a class="file-reference reference-${reference.relationship}" href="${escape(reference.path)}" data-reference-id="${reference.id}" title="${escape(`${reference.relationship}: ${reference.path} (${reference.syntax})`)}"><span class="reference-icon" aria-hidden="true">${icons[reference.relationship]}</span><span class="sr-only">${reference.relationship}: </span>${escape(reference.label)}</a>`;
  md.inline.ruler.before('link', 'file-references', (state, silent) => {
    if ((state as typeof state & { linkLevel: number }).linkLevel > 0) return false;
    const source = state.src.slice(state.pos);
    let match: RegExpMatchArray | null;
    let path = '', label = '', syntax = '', relationship: FileReference['relationship'] = 'include', length = 0;
    if ((match = source.match(/^\{\{\s*include\s*:\s*([^}\n]+)\}\}/))) { path = match[1].trim(); syntax = 'Include directive'; length = match[0].length; }
    else if ((match = source.match(/^\{\{\s*include\s+["']([^"'\n]+)["']\s*\}\}/))) { path = match[1]; syntax = 'Retype'; length = match[0].length; }
    else if ((match = source.match(/^{%\s*(include|include_relative)\s+(?:"([^"]+)"|'([^']+)'|([^\s%]+))(?:\s+[^%]*)?\s*%}/))) { path = match[2] || match[3] || match[4]; syntax = match[1] === 'include_relative' ? 'Jekyll relative' : 'Jekyll'; length = match[0].length; }
    else if ((match = source.match(/^\[!INCLUDE\s+\[([^\]]*)\]\(([^)\n]+)\)\s*\]/i))) { path = match[2].trim().replace(/^<|>$/g, ''); label = match[1]; syntax = 'DocFX'; length = match[0].length; }
    else if ((match = source.match(/^\[!code-[\w+-]+\s*\[([^\]]*)\]\(([^)\n]+)\)\s*\]/i))) { path = match[2].trim(); label = match[1]; syntax = 'DocFX code'; length = match[0].length; }
    else if ((match = source.match(/^(!?)\[\[([^\]\n]+)\]\]/))) { const parts = match[2].split('|'); path = parts[0]; label = parts[1] || path; syntax = 'Obsidian'; relationship = match[1] ? 'embed' : 'link'; length = match[0].length; }
    else if ((match = source.match(/^<!--\s*@?include\s*:\s*([^\n]+?)\s*-->/i))) { path = match[1].trim().replace(/\{[\d,-]+\}$/, ''); syntax = 'Include comment'; length = match[0].length; }
    else if ((match = source.match(/^\{!!\s*([^!\n]+?)\s*!!\}/))) { path = match[1].trim(); syntax = 'Markdown Include'; length = match[0].length; }
    else if (state.src[state.pos] === '@' && (state.pos === 0 || /[\s(]/.test(state.src[state.pos - 1])) && (match = source.match(/^@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s<>`()[\]{};,!?]+))/))) {
      path = (match[1] || match[2] || match[3]).replace(/[.,:]+$/, '');
      if (!/(?:[\\/]|\.[\w-]+(?:#.*)?$)/.test(path) && !/^(?:README|LICENSE|AGENTS|CLAUDE)$/i.test(path)) return false;
      syntax = 'Claude'; relationship = 'import'; length = match[0].length - ((match[3]?.length ?? path.length) - path.length);
    } else return false;
    const reference = silent ? undefined : register(path.replace(/^"|"$|^'|'$/g, ''), syntax, relationship, label || path);
    if (!silent && !reference) return false;
    if (!silent) { const token = state.push('file_reference', '', 0); token.meta = reference; }
    state.pos += length;
    return true;
  });
  md.renderer.rules.file_reference = (tokens, index) => anchor(tokens[index].meta);

  md.block.ruler.before('hr', 'snippet-references', (state, startLine, endLine, silent) => {
    const line = (number: number) => state.src.slice(state.bMarks[number] + state.tShift[number], state.eMarks[number]);
    const opening = line(startLine).match(/^-+8<-+\s*(?:"([^"]+)"|'([^']+)')?\s*$/);
    if (!opening || state.sCount[startLine] - state.blkIndent >= 4) return false;
    let next = startLine + 1;
    const paths: string[] = [];
    if (opening[1] || opening[2]) paths.push(opening[1] || opening[2]);
    else {
      while (next < endLine && !/^-+8<-+\s*$/.test(line(next))) {
        if (state.sCount[next] < state.blkIndent) return false;
        const path = line(next).trim(); if (path && !path.startsWith(';')) paths.push(path);
        next++;
      }
      if (next === endLine) return false;
      next++;
    }
    if (silent) return true;
    const token = state.push('snippet_references', '', 0);
    token.map = [startLine, next];
    token.meta = paths.filter(path => !path.startsWith(';')).map(path => register(path, 'PyMdown', 'include') ?? { raw: path });
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.snippet_references = (tokens, index) => `<div class="snippet-references">${tokens[index].meta.map((item: FileReference | { raw: string }) => 'raw' in item ? escape(`--8<-- "${item.raw}"`) : anchor(item)).join('<br>')}</div>\n`;

  const linkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const href = token.attrGet('href') || '';
    const isInclude = token.attrGet('title')?.startsWith(':include');
    const reference = href && !href.startsWith('#') && (isInclude || !/^[a-z][a-z\d+.-]*:/i.test(href)) ? register(href, isInclude ? 'Docsify' : 'Markdown', isInclude ? 'include' : 'link') : undefined;
    if (reference) { token.attrJoin('class', `file-reference reference-${reference.relationship}`); token.attrSet('data-reference-id', reference.id); token.attrSet('title', `${reference.relationship}: ${href} (${reference.syntax})`); }
    return (linkOpen ? linkOpen(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)) + (reference ? `<span class="reference-icon" aria-hidden="true">${icons[reference.relationship]}</span><span class="sr-only">${reference.relationship}: </span>` : '');
  };
}
