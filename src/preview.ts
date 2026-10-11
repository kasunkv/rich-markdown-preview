import mermaid from 'mermaid';
import type { OutlineItem } from './render';
import { previewStyles } from './styles';
import { enhanceTables, type TableState } from './tables';
import { documentationView, type DocumentationViewState } from './documentation-view';
interface ReadingState { scroll?: number; tables?: TableState }
interface PreviewState extends ReadingState { documentation?: DocumentationViewState; documentId?: string; documents?: Record<string, ReadingState> }
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): PreviewState | undefined; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
app.innerHTML = `<header class="toolbar" aria-label="Preview controls"><div class="brand"><img class="brand-icon" src="${app.dataset.logo || '/rich-markdown-preview.png'}" alt="" width="34" height="34"><span>Rich Markdown<small>PREVIEW</small></span></div><div class="controls"><label>Style<select id="style" aria-label="Style">${previewStyles.map(style => `<option value="${style.id}">${style.label}</option>`).join('')}</select></label><label>Appearance<select id="appearance" aria-label="Appearance"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Width <output id="width-value"></output><input id="contentWidth" aria-label="Content width" type="range" min="480" max="1600" step="20"></label><label>Text<select id="fontSize" aria-label="Text size">${[12,14,16,18,20,22,24].map(n => `<option value="${n}">${n}px</option>`).join('')}</select></label><label>Spacing<select id="lineHeight" aria-label="Line spacing">${[1.3,1.5,1.7,1.9,2.2].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label><label class="checkbox"><input id="wrapCode" type="checkbox">Wrap code</label><button id="toggle-outline" type="button" aria-expanded="true">Outline</button></div></header><div class="layout"><aside class="outline" aria-label="Document outline"><p>ON THIS PAGE</p><nav id="outline"></nav></aside><main id="content" class="markdown" aria-label="Markdown preview"></main></div><div id="announcement" class="sr-only" aria-live="polite"></div>`;
const content = document.getElementById('content')!;
const outline = document.getElementById('outline')!;
const documentation = documentationView(vscode, content);
let revision = 0;
let restored = false;
let diagramSequence = 0;
interface Preferences { style: string; appearance: string; contentWidth: number; fontSize: number; lineHeight: number; wrapCode: boolean }
let currentPreferences: Preferences = { style: 'documentation', appearance: 'auto', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false };
const pendingPreferences = new Map<keyof Preferences, Preferences[keyof Preferences]>();
let diagramSources = new WeakMap<HTMLElement, string>();
let tableState: TableState = vscode.getState()?.tables ?? {};
let documentId = vscode.getState()?.documentId;
const readingStates = vscode.getState()?.documents ?? {};
function saveState() {
  if (documentId) readingStates[documentId] = { scroll: window.scrollY, tables: tableState };
  vscode.setState({ ...vscode.getState(), scroll: window.scrollY, tables: tableState, documentId, documents: readingStates });
}
function isDark() {
  return document.body.dataset.appearance === 'dark' || (document.body.dataset.appearance === 'auto' && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')));
}
function applyPreferences(settings: Preferences, refreshDiagrams = true) {
  const previousDark = isDark();
  const previousStyle = currentPreferences.style;
  currentPreferences = settings;
  document.body.dataset.style = settings.style;
  document.body.dataset.appearance = settings.appearance;
  document.body.classList.toggle('wrap-code', settings.wrapCode);
  document.documentElement.style.setProperty('--content-width', `${settings.contentWidth}px`);
  document.documentElement.style.setProperty('--reading-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--reading-line-height', `${settings.lineHeight}`);
  for (const [key, value] of Object.entries(settings)) {
    const control = document.getElementById(key) as HTMLInputElement | HTMLSelectElement;
    if (key === 'wrapCode') (control as HTMLInputElement).checked = Boolean(value);
    else control.value = String(value);
  }
  document.getElementById('width-value')!.textContent = `${settings.contentWidth}px`;
  if (refreshDiagrams && (previousDark !== isDark() || previousStyle !== settings.style)) void diagrams(++revision);
}
function receivePreferences(saved: Preferences, refreshDiagrams = true) {
  for (const [key, value] of pendingPreferences) { if (saved[key] === value) pendingPreferences.delete(key); }
  applyPreferences({ ...saved, ...Object.fromEntries(pendingPreferences) }, refreshDiagrams);
}
function scrollToHeading(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
async function diagrams(version: number) {
  const dark = isDark();
  const palette = getComputedStyle(document.body);
  const color = (name: string) => palette.getPropertyValue(name).trim();
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', theme: 'base', suppressErrorRendering: true,
    themeVariables: {
      darkMode: dark, background: color('--surface'), fontFamily: color('--diagram-font'),
      primaryColor: color('--code'), primaryTextColor: color('--text'), primaryBorderColor: color('--accent'),
      secondaryColor: color('--surface'), secondaryTextColor: color('--text'), secondaryBorderColor: color('--border'),
      tertiaryColor: color('--bg'), tertiaryTextColor: color('--text'), tertiaryBorderColor: color('--border'),
      lineColor: color('--muted'), textColor: color('--text'), mainBkg: color('--code'),
      nodeBorder: color('--accent'), clusterBkg: color('--surface'), clusterBorder: color('--border'),
      edgeLabelBackground: color('--surface'), actorBkg: color('--code'), actorTextColor: color('--text'),
      actorBorder: color('--accent'), actorLineColor: color('--muted'), signalColor: color('--text'),
      signalTextColor: color('--text'), labelBoxBkgColor: color('--surface'), labelTextColor: color('--text'),
      pie1: color('--accent'), pie2: color('--syntax-string'), pie3: color('--syntax-keyword'),
      pie4: color('--syntax-number'), pie5: color('--muted'), pie6: color(dark ? '--border' : '--text'),
      pieSectionTextColor: color('--surface'), pieTitleTextColor: color('--text'), pieLegendTextColor: color('--text'),
      // Translucent slices wash out the light labels against a pale diagram surface.
      ...(!dark ? { pieOpacity: 1 } : {}),
      xyChart: { backgroundColor: color('--surface'), titleColor: color('--text'),
        xAxisLabelColor: color('--text'), xAxisTitleColor: color('--text'), xAxisLineColor: color('--muted'),
        yAxisLabelColor: color('--text'), yAxisTitleColor: color('--text'), yAxisLineColor: color('--muted'),
        plotColorPalette: [color('--accent'), color('--syntax-string'), color('--syntax-keyword')].join(',') }
    }
  });
  for (const figure of content.querySelectorAll<HTMLElement>('.diagram')) {
    if (version !== revision) return;
    const text = diagramSources.get(figure);
    if (text === undefined) continue;
    try {
      const { svg } = await mermaid.render(`diagram-${++diagramSequence}`, text);
      if (version !== revision) return;
      const target = document.createElement('div'); target.className = 'mermaid-result'; target.innerHTML = svg;
      figure.querySelector('.diagram-error')?.remove();
      figure.querySelector('.mermaid-source, .mermaid-result')?.replaceWith(target);
    } catch {
      if (version !== revision) return;
      figure.querySelector('.diagram-error')?.remove();
      const source = document.createElement('pre'); source.className = 'mermaid-source'; source.textContent = text;
      figure.querySelector('.mermaid-source, .mermaid-result')?.replaceWith(source);
      const error = document.createElement('p'); error.className = 'diagram-error'; error.textContent = 'Could not render this Mermaid diagram. Check the syntax below.'; source.before(error);
    }
  }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'documentation') { documentation.receive(message); return; }
  if (message.type === 'copyResult') {
    document.getElementById('announcement')!.textContent = message.success ? 'Code copied' : 'Could not copy code. Please try again.';
    return;
  }
  if (message.type === 'tableActionResult') {
    document.getElementById('announcement')!.textContent = message.cancelled ? 'CSV export cancelled' : message.success ? (message.action === 'tableCopy' ? 'Table CSV copied' : 'Table CSV exported') : `Table action failed: ${message.error ?? 'Please try again'}`;
    return;
  }
  if (message.type === 'preferences') { receivePreferences(message.preferences); return; }
  if (message.type !== 'render') return;
  if (message.documentationHome) documentation.enable();
  const changedDocument = message.documentationHome && message.documentId !== documentId;
  if (changedDocument) {
    if (restored) saveState();
    documentId = message.documentId;
    tableState = readingStates[documentId!]?.tables ?? {};
  }
  const scroll = changedDocument ? readingStates[documentId!]?.scroll ?? 0 : restored ? window.scrollY : vscode.getState()?.scroll ?? 0;
  restored = true;
  const version = ++revision;
  receivePreferences(message.preferences, false);
  content.innerHTML = message.html || '<div class="empty"><h1>Your next idea starts here.</h1><p>Start writing Markdown to see your document take shape.</p></div>';
  tableState = enhanceTables(content, tableState, action => {
    document.getElementById('announcement')!.textContent = action.type === 'tableCopy' ? 'Copying table CSV…' : 'Choose where to save the CSV file';
    vscode.postMessage(action);
  }, state => { tableState = state; saveState(); });
  diagramSources = new WeakMap();
  for (const figure of content.querySelectorAll<HTMLElement>('.diagram')) { diagramSources.set(figure, figure.querySelector('.mermaid-source')?.textContent ?? ''); }
  outline.replaceChildren();
  for (const item of message.outline as OutlineItem[]) {
    const link = document.createElement('a'); link.textContent = item.text; link.href = `#${item.id}`; link.style.paddingLeft = `${Math.min(item.level - 1, 3) * 12 + 10}px`;
    link.addEventListener('click', event => { event.preventDefault(); scrollToHeading(item.id); }); outline.append(link);
  }
  if (!message.outline.length) outline.textContent = 'Headings will appear here.';
  window.scrollTo(0, scroll);
  // Mermaid may change document height; restore the requested position after it settles.
  void diagrams(version).then(() => {
    if (version !== revision) return;
    if (typeof message.fragment === 'string' && message.fragment) scrollToHeading(message.fragment);
    else if (changedDocument) window.scrollTo(0, scroll);
    saveState();
  });
});
document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.controls input, .controls select').forEach(control => {
  const updateLocal = () => {
    const key = control.id as keyof Preferences;
    const value = key === 'wrapCode' ? (control as HTMLInputElement).checked : ['contentWidth','fontSize','lineHeight'].includes(key) ? Number(control.value) : control.value;
    pendingPreferences.set(key, value);
    applyPreferences({ ...currentPreferences, [key]: value });
    return { key, value };
  };
  control.addEventListener('input', updateLocal);
  // Persist on commit; slider input only updates local layout while dragging.
  control.addEventListener('change', () => vscode.postMessage({ type: 'preference', ...updateLocal() }));
});
document.getElementById('toggle-outline')!.addEventListener('click', event => {
  const hidden = document.body.classList.toggle('hide-outline'); (event.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!hidden));
});
content.addEventListener('click', event => {
  const element = event.target as HTMLElement;
  const copy = element.closest<HTMLButtonElement>('.copy-code');
  if (copy) { vscode.postMessage({ type: 'copy', text: copy.closest('.code-block')?.querySelector('code')?.textContent ?? '' }); document.getElementById('announcement')!.textContent = 'Copying code…'; return; }
  const link = element.closest<HTMLAnchorElement>('a');
  if (link?.dataset.referenceId) { event.preventDefault(); vscode.postMessage({ type: 'reference', id: link.dataset.referenceId }); return; }
  if (link) { event.preventDefault(); const href = link.getAttribute('href') ?? ''; if (href.startsWith('#')) { try { scrollToHeading(decodeURIComponent(href.slice(1))); } catch {} } else vscode.postMessage({ type: 'link', href }); }
});
// VS Code changes body classes when its theme changes without sending a preference message.
const vscodeDarkTheme = () => document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
let lastVscodeDarkTheme = vscodeDarkTheme();
new MutationObserver(() => {
  const dark = vscodeDarkTheme();
  if (currentPreferences.appearance === 'auto' && dark !== lastVscodeDarkTheme) void diagrams(++revision);
  lastVscodeDarkTheme = dark;
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('scroll', saveState, { passive: true });
vscode.postMessage({ type: 'ready' });
