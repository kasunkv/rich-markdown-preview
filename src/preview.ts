import { RenderCache, diagramRenderKey } from './render-work';
import { isolateDiagramSvg } from './diagram-cache';
import { renderLimits } from './render-limits';
import { reportAsync } from './async';
import mermaid from 'mermaid';
import {
  validateWebviewMessage,
  validateHostMessage,
  type Preferences,
  type WebviewMessage,
  type WebviewCommand,
} from './messages';
import { previewStyles } from './styles';
import { enhanceTables, type TableState } from './tables';
import { documentationView } from './documentation-view';
import { numericPreferenceRanges } from './preference-ranges';
import { boundReadingState, restoreReadingState, type PersistedReadingState, type ReadingState } from './reading-state';
type InteractionSelection = [number, number, 'forward' | 'backward' | 'none'];
declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const api = acquireVsCodeApi();
let savedState = restoreReadingState(api.getState());
let lastSavedJson = JSON.stringify(savedState);
let renderId = 'bootstrap';
const requestPrefix = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('');
let requestSequence = 0;
let latestActionRequestId: string | undefined;
const pendingActions = new Map<string, { type: string; renderId: string }>();
const vscode = {
  postMessage(command: WebviewCommand) {
    if (['documentationAction', 'reference', 'link'].includes(command.type)) flushScrollState(true);
    const message =
      command.type === 'ready' ? command : { ...command, requestId: requestPrefix + '_' + ++requestSequence, renderId };
    if (!validateWebviewMessage(message)) {
      if (command.type === 'copy' || command.type === 'tableCopy' || command.type === 'tableExport') {
        latestActionRequestId = undefined;
        document.getElementById('rmp-ui-announcement')!.textContent =
          command.type === 'copy'
            ? 'This code block cannot be copied. Try selecting a smaller portion in the source.'
            : 'This table cannot be copied or exported. Try filtering to fewer rows.';
      }
      return;
    }
    if (message.type !== 'ready' && ['copy', 'tableCopy', 'tableExport'].includes(message.type)) {
      pendingActions.set(message.requestId, { type: message.type, renderId });
      latestActionRequestId = message.requestId;
    }
    api.postMessage(message);
  },
  getState(): PersistedReadingState {
    return savedState;
  },
  setState(state: unknown) {
    savedState = restoreReadingState(state);
    readingStates = savedState.documents;
    const json = JSON.stringify(savedState);
    if (json !== lastSavedJson) {
      api.setState(savedState);
      lastSavedJson = json;
    }
  },
};
const app = document.getElementById('rmp-ui-app')!;
app.innerHTML = `<header class="toolbar" aria-label="Preview controls"><div class="brand"><img class="brand-icon" src="${app.dataset.logo || '/rich-markdown-preview.png'}" alt="" width="34" height="34"><span>Rich Markdown<small>PREVIEW</small></span></div><div class="controls"><label>Style<select id="rmp-ui-style" data-preference-key="style" aria-label="Style">${previewStyles.map((style) => `<option value="${style.id}">${style.label}</option>`).join('')}</select></label><label>Appearance<select id="rmp-ui-appearance" data-preference-key="appearance" aria-label="Appearance"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Width <output id="rmp-ui-width-value" data-preference-output="contentWidth"></output><input id="rmp-ui-contentWidth" data-preference-key="contentWidth" aria-label="Content width" type="range" min="${numericPreferenceRanges.contentWidth[0]}" max="${numericPreferenceRanges.contentWidth[1]}" step="any"><input id="rmp-ui-contentWidth-entry" data-preference-key="contentWidth" aria-label="Content width value" type="number" min="${numericPreferenceRanges.contentWidth[0]}" max="${numericPreferenceRanges.contentWidth[1]}" step="any"></label><label>Text <input id="rmp-ui-fontSize" data-preference-key="fontSize" aria-label="Text size" type="number" min="${numericPreferenceRanges.fontSize[0]}" max="${numericPreferenceRanges.fontSize[1]}" step="any"></label><label>Spacing <input id="rmp-ui-lineHeight" data-preference-key="lineHeight" aria-label="Line spacing" type="number" min="${numericPreferenceRanges.lineHeight[0]}" max="${numericPreferenceRanges.lineHeight[1]}" step="any"></label><label class="checkbox"><input id="rmp-ui-wrapCode" data-preference-key="wrapCode" type="checkbox">Wrap code</label><button id="rmp-ui-toggle-outline" type="button" aria-expanded="true">Outline</button></div></header><div class="layout"><aside class="outline" aria-label="Document outline"><p>ON THIS PAGE</p><nav id="rmp-ui-outline"></nav></aside><main id="rmp-ui-content" class="markdown" aria-label="Markdown preview"></main></div><div id="rmp-ui-announcement" class="sr-only" aria-live="polite"></div>`;
const content = document.getElementById('rmp-ui-content')!;
const outline = document.getElementById('rmp-ui-outline')!;
const documentation = documentationView(vscode, content);
let revision = 0;
let restored = false;
let diagramSequence = 0;
const diagramCache = new RenderCache<string>(40, 2_000_000);
let diagramQueue: Promise<void> = Promise.resolve();
let currentPreferences: Preferences = {
  style: 'documentation',
  appearance: 'auto',
  contentWidth: 900,
  fontSize: 16,
  lineHeight: 1.7,
  wrapCode: false,
};
const pendingPreferences = new Map<keyof Preferences, Preferences[keyof Preferences]>();
let diagramSources = new WeakMap<HTMLElement, string>();
let tableState: TableState = savedState.tables ?? {};
let disclosureState: Record<string, boolean> = savedState.disclosures ?? {};
let documentId = savedState.documentId;
let readingStates: Record<string, ReadingState> = savedState.documents;
function rememberPermissionFocus() {
  const active = document.activeElement;
  const key = active instanceof HTMLElement ? active.dataset.readingKey : undefined;
  const selection: InteractionSelection | undefined =
    active instanceof HTMLInputElement && active.selectionStart !== null && active.selectionEnd !== null
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection ?? 'none']
      : undefined;
  saveState();
  vscode.setState({
    ...vscode.getState(),
    permissionFocus: key && key.length <= 8192 ? { key, documentId, selection } : undefined,
  });
}
app.addEventListener('focusin', (event) => {
  const saved = vscode.getState()?.permissionFocus;
  if (saved && (!(event.target instanceof HTMLElement) || event.target.dataset.readingKey !== saved.key))
    vscode.setState({ ...vscode.getState(), permissionFocus: undefined });
});
function saveState() {
  if (documentId)
    readingStates[documentId] = { scroll: window.scrollY, tables: tableState, disclosures: disclosureState };
  const order = savedState.documentOrder.filter((id) => id !== documentId);
  if (documentId) order.push(documentId);
  vscode.setState({
    ...vscode.getState(),
    scroll: window.scrollY,
    tables: tableState,
    disclosures: disclosureState,
    documentId,
    documents: readingStates,
    documentOrder: order,
  });
}
let scrollDelay: ReturnType<typeof setTimeout> | undefined;
let scrollDeadline: ReturnType<typeof setTimeout> | undefined;
let scrollDirty = false;
function flushScrollState(force = false) {
  clearTimeout(scrollDelay);
  clearTimeout(scrollDeadline);
  scrollDelay = scrollDeadline = undefined;
  if (scrollDirty || force) {
    scrollDirty = false;
    saveState();
  }
}
function scheduleScrollState() {
  scrollDirty = true;
  clearTimeout(scrollDelay);
  scrollDelay = setTimeout(() => flushScrollState(), 200);
  scrollDeadline ??= setTimeout(() => flushScrollState(), 1000);
}
// Keys describe content roles and section labels, so inserting unrelated content does not
// redirect an ongoing interaction to a different control. Duplicate roles use occurrence.
function identifyInteractions() {
  for (const anchor of content.querySelectorAll<HTMLElement>('[data-md-anchor]')) {
    anchor.dataset.readingKey = JSON.stringify(['anchor', anchor.id]);
    if (!anchor.hasAttribute('tabindex')) anchor.tabIndex = -1;
  }
  const occurrences = new Map<string, number>();
  for (const element of content.querySelectorAll<HTMLElement>(
    'details, summary, pre[tabindex], a[href], button, input, select',
  )) {
    if (element.dataset.readingKey) continue;
    const sectionHeading = Array.from(content.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter((heading) => !!(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
      .at(-1);
    const section =
      sectionHeading?.getAttribute('data-reading-heading-label') ?? sectionHeading?.textContent?.trim() ?? '';
    const details = element.closest('details');
    const role = details?.className || element.className;
    const label =
      element.tagName === 'PRE'
        ? details?.querySelector('summary')?.textContent
        : element.tagName === 'DETAILS'
          ? element.querySelector('summary')?.textContent
          : element.textContent;
    const identity = JSON.stringify([section, element.tagName, role, label?.trim(), element.getAttribute('href')]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    element.dataset.readingKey = JSON.stringify([identity, occurrence]);
  }
}
function captureDisclosures() {
  disclosureState = Object.fromEntries(
    Array.from(content.querySelectorAll('details'), (details) => [details.dataset.readingKey!, details.open]),
  );
}
function restoreDisclosures() {
  for (const details of content.querySelectorAll('details')) {
    const open = disclosureState[details.dataset.readingKey!];
    if (typeof open === 'boolean') details.open = open;
  }
  captureDisclosures();
}
function restoreFocus(key: string, selection?: [number, number, 'forward' | 'backward' | 'none']) {
  const equivalent = Array.from(app.querySelectorAll<HTMLElement>('[data-reading-key]')).find(
    (element) => element.dataset.readingKey === key,
  );
  const target =
    equivalent && !equivalent.matches(':disabled') && equivalent.getClientRects().length ? equivalent : content;
  if (target === content) content.tabIndex = -1;
  target.focus({ preventScroll: true });
  if (selection && target instanceof HTMLInputElement) target.setSelectionRange(...selection);
}
content.addEventListener(
  'toggle',
  (event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.isConnected) return;
    captureDisclosures();
    saveState();
  },
  true,
);
function isDark() {
  return getComputedStyle(document.body).colorScheme === 'dark';
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
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      `[data-preference-key="${key}"]`,
    )) {
      if (key === 'wrapCode') (control as HTMLInputElement).checked = Boolean(value);
      else control.value = String(value);
    }
  }
  document.querySelector('[data-preference-output="contentWidth"]')!.textContent = `${settings.contentWidth}px`;
  if (refreshDiagrams && (previousDark !== isDark() || previousStyle !== settings.style))
    reportAsync(diagrams(++revision));
}
function receivePreferences(saved: Preferences, refreshDiagrams = true) {
  for (const [key, value] of pendingPreferences) {
    if (saved[key] === value) pendingPreferences.delete(key);
  }
  applyPreferences({ ...saved, ...Object.fromEntries(pendingPreferences) }, refreshDiagrams);
}
function isNumericPreference(key: keyof Preferences) {
  return key === 'contentWidth' || key === 'fontSize' || key === 'lineHeight';
}
function preferenceControlValue(control: HTMLInputElement | HTMLSelectElement, key: keyof Preferences) {
  return key === 'wrapCode'
    ? (control as HTMLInputElement).checked
    : isNumericPreference(key)
      ? Number(control.value)
      : control.value;
}
function validNumericControl(control: HTMLInputElement | HTMLSelectElement) {
  return Boolean(control.value) && control.validity.valid && Number.isFinite(Number(control.value));
}
// Author fragments use aliases (headings win over footnotes); internal links use
// exact DOM IDs. Both paths stay inside Markdown, including missing anchors.
function findContentAnchor(fragment: string, internal = false): HTMLElement | undefined {
  let id: string;
  try {
    id = decodeURIComponent(fragment.replace(/^#/, ''));
  } catch {
    return undefined;
  }
  const targets = Array.from(content.querySelectorAll<HTMLElement>('[id]'));
  if (!internal) {
    const alias =
      targets.find((target) => target.dataset.mdAnchor === id && /^H[1-6]$/.test(target.tagName)) ??
      targets.find((target) => target.dataset.mdAnchor === id);
    if (alias) return alias;
  }
  return targets.find((target) => target.id === id);
}
function scrollToHeading(fragment: string, internal = false) {
  const target = findContentAnchor(fragment, internal);
  if (target) {
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    target.scrollIntoView({ behavior, block: 'start' });
  } else {
    document.getElementById('rmp-ui-announcement')!.textContent =
      'Heading not found. Check the heading and fragment encoding. Line fragments such as #L1-L3 are unsupported; use Go to Line in the source editor.';
  }
}
function diagrams(version: number): Promise<void> {
  const work = diagramQueue.then(() => renderDiagrams(version));
  diagramQueue = work.catch(() => {});
  return work;
}
async function renderDiagrams(version: number) {
  if (version !== revision || document.hidden) return;
  const dark = isDark();
  const palette = getComputedStyle(document.body);
  const color = (name: string) => palette.getPropertyValue(name).trim();
  const themeKey = JSON.stringify([
    dark,
    currentPreferences.style,
    currentPreferences.appearance,
    [...Array.from(document.styleSheets, (sheet) => sheet.href)],
    [
      '--surface',
      '--diagram-font',
      '--code',
      '--text',
      '--accent',
      '--border',
      '--bg',
      '--muted',
      '--syntax-string',
      '--syntax-keyword',
      '--syntax-number',
    ].map(color),
  ]);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering'],
    maxTextSize: renderLimits.diagramCharacters,
    maxEdges: renderLimits.diagramEdges,
    theme: 'base',
    suppressErrorRendering: true,
    themeVariables: {
      darkMode: dark,
      background: color('--surface'),
      fontFamily: color('--diagram-font'),
      primaryColor: color('--code'),
      primaryTextColor: color('--text'),
      primaryBorderColor: color('--accent'),
      secondaryColor: color('--surface'),
      secondaryTextColor: color('--text'),
      secondaryBorderColor: color('--border'),
      tertiaryColor: color('--bg'),
      tertiaryTextColor: color('--text'),
      tertiaryBorderColor: color('--border'),
      lineColor: color('--muted'),
      textColor: color('--text'),
      mainBkg: color('--code'),
      nodeBorder: color('--accent'),
      clusterBkg: color('--surface'),
      clusterBorder: color('--border'),
      edgeLabelBackground: color('--surface'),
      actorBkg: color('--code'),
      actorTextColor: color('--text'),
      actorBorder: color('--accent'),
      actorLineColor: color('--muted'),
      signalColor: color('--text'),
      signalTextColor: color('--text'),
      labelBoxBkgColor: color('--surface'),
      labelTextColor: color('--text'),
      pie1: color('--accent'),
      pie2: color('--syntax-string'),
      pie3: color('--syntax-keyword'),
      pie4: color('--syntax-number'),
      pie5: color('--muted'),
      pie6: color(dark ? '--border' : '--text'),
      pieSectionTextColor: color('--surface'),
      pieTitleTextColor: color('--text'),
      pieLegendTextColor: color('--text'),
      // Translucent slices wash out the light labels against a pale diagram surface.
      ...(!dark ? { pieOpacity: 1 } : {}),
      xyChart: {
        backgroundColor: color('--surface'),
        titleColor: color('--text'),
        xAxisLabelColor: color('--text'),
        xAxisTitleColor: color('--text'),
        xAxisLineColor: color('--muted'),
        yAxisLabelColor: color('--text'),
        yAxisTitleColor: color('--text'),
        yAxisLineColor: color('--muted'),
        plotColorPalette: [color('--accent'), color('--syntax-string'), color('--syntax-keyword')].join(','),
      },
    },
  });
  for (const figure of content.querySelectorAll<HTMLElement>('.diagram')) {
    if (version !== revision || document.hidden) return;
    const text = diagramSources.get(figure);
    if (text === undefined) continue;
    try {
      const key = diagramRenderKey(text, themeKey, 'strict-mermaid11-svg-v1');
      let svg = diagramCache.get(key);
      if (!svg) {
        const rendered = await mermaid.render(`diagram-${++diagramSequence}`, text);
        if (version !== revision || document.hidden) return;
        svg = rendered.svg;
      }
      const isolated = isolateDiagramSvg(svg, `rmp-diagram-${++diagramSequence}`);
      if (!isolated) throw new Error('Unsupported diagram SVG');
      diagramCache.set(key, svg, svg.length);
      if (version !== revision || document.hidden) return;
      const target = document.createElement('div');
      target.className = 'mermaid-result';
      target.append(isolated);
      figure.querySelector('.diagram-error')?.remove();
      const image = target.querySelector('svg');
      if (image && !image.querySelector('title')) {
        image.setAttribute('role', 'img');
        image.setAttribute(
          'aria-label',
          `${text.trim().split(/[\s;]/)[0]} diagram. Read Diagram source for its nodes and relationships.`,
        );
      }
      const previous = figure.querySelector('.mermaid-result');
      if (previous) previous.replaceWith(target);
      else figure.querySelector('.diagram-source')?.before(target);
    } catch {
      if (version !== revision) return;
      figure.querySelector('.diagram-error')?.remove();
      figure.querySelector('.mermaid-result')?.remove();
      const disclosure = figure.querySelector<HTMLDetailsElement>('.diagram-source');
      if (disclosure) disclosure.open = true;
      const error = document.createElement('p');
      error.className = 'diagram-error';
      error.textContent = 'Could not render this Mermaid diagram. Check the syntax below.';
      disclosure?.before(error);
    }
  }
}
document.addEventListener('visibilitychange', () => {
  ++revision;
  if (!document.hidden) reportAsync(diagrams(revision));
});
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!validateHostMessage(message)) return;
  if (message.type === 'copyResult' || message.type === 'tableActionResult') {
    const pending = pendingActions.get(message.requestId);
    if (
      !pending ||
      pending.renderId !== renderId ||
      pending.type !== (message.type === 'copyResult' ? 'copy' : message.action)
    )
      return;
    pendingActions.delete(message.requestId);
    if (message.requestId !== latestActionRequestId) return;
  }
  if (message.type === 'documentation') {
    if (!message.loading && !message.error) {
      const documents = new Set(message.files.map((file) => file.id));
      documents.add('home');
      vscode.setState(boundReadingState(savedState, documents));
    }
    documentation.receive(message);
    return;
  }
  if (message.type === 'copyResult') {
    document.getElementById('rmp-ui-announcement')!.textContent = message.success
      ? 'Code copied'
      : 'Could not copy code. Please try again.';
    return;
  }
  if (message.type === 'tableActionResult') {
    document.getElementById('rmp-ui-announcement')!.textContent = message.cancelled
      ? 'CSV export cancelled'
      : message.success
        ? message.action === 'tableCopy'
          ? 'Table CSV copied'
          : 'Table CSV exported'
        : `Table action failed: ${message.error ?? 'Please try again'}`;
    return;
  }
  if (message.type === 'preferences') {
    receivePreferences(message.preferences);
    return;
  }
  if (message.type !== 'render') return;
  if (message.renderId && message.renderId !== renderId) {
    renderId = message.renderId;
    pendingActions.clear();
  }
  if (message.documentationHome) documentation.enable();
  const savedFocus = !restored ? vscode.getState()?.permissionFocus : undefined;
  const resumeFocus = savedFocus?.documentId === documentId && document.hasFocus() ? savedFocus : undefined;
  if (!restored) vscode.setState({ ...vscode.getState(), permissionFocus: undefined });
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement && (content.contains(active) || outline.contains(active))
      ? active.dataset.readingKey
      : resumeFocus?.key;
  const selection: InteractionSelection | undefined =
    active instanceof HTMLInputElement && active.selectionStart !== null && active.selectionEnd !== null
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection ?? 'none']
      : resumeFocus?.selection;
  if (restored) captureDisclosures();
  const changedDocument = typeof message.documentId === 'string' && message.documentId !== documentId;
  if (changedDocument) {
    if (restored) flushScrollState(true);
    documentId = message.documentId;
    tableState = readingStates[documentId!]?.tables ?? {};
    disclosureState = readingStates[documentId!]?.disclosures ?? {};
  }
  vscode.setState({ ...vscode.getState(), session: message.session });
  const scroll = changedDocument
    ? (readingStates[documentId!]?.scroll ?? 0)
    : restored
      ? window.scrollY
      : (vscode.getState()?.scroll ?? 0);
  restored = true;
  const version = ++revision;
  receivePreferences(message.preferences, false);
  content.innerHTML =
    message.html ||
    '<div class="empty"><h1>Your next idea starts here.</h1><p>Start writing Markdown to see your document take shape.</p></div>';
  tableState = enhanceTables(
    content,
    tableState,
    (action) => {
      document.getElementById('rmp-ui-announcement')!.textContent =
        action.type === 'tableCopy' ? 'Copying table CSV…' : 'Choose where to save the CSV file';
      vscode.postMessage(action);
    },
    (state) => {
      tableState = state;
      saveState();
    },
  );
  identifyInteractions();
  restoreDisclosures();
  diagramSources = new WeakMap();
  for (const figure of content.querySelectorAll<HTMLElement>('.diagram')) {
    const source = figure.querySelector('.mermaid-source');
    if (source) diagramSources.set(figure, source.textContent ?? '');
  }
  outline.replaceChildren();
  for (const item of message.outline) {
    const link = document.createElement('a');
    link.textContent = item.text;
    link.href = `#${item.id}`;
    link.dataset.readingKey = JSON.stringify(['outline', item.id]);
    link.style.paddingLeft = `${Math.min(item.level - 1, 3) * 12 + 10}px`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      scrollToHeading(item.id, true);
    });
    outline.append(link);
  }
  if (!message.outline.length) outline.textContent = 'Headings will appear here.';
  if (focusKey) {
    if (!changedDocument && !message.fragment) restoreFocus(focusKey, selection);
    else {
      content.tabIndex = -1;
      content.focus({ preventScroll: true });
    }
  }
  window.scrollTo(0, scroll);
  saveState();
  // Mermaid may change document height; restore the requested position after it settles.
  reportAsync(
    diagrams(version).then(() => {
      if (version !== revision) return;
      if (typeof message.fragment === 'string' && message.fragment) scrollToHeading(message.fragment);
      else if (changedDocument) window.scrollTo(0, scroll);
      saveState();
    }),
  );
});
document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-preference-key]').forEach((control) => {
  const key = control.dataset.preferenceKey as keyof Preferences;
  const numeric = isNumericPreference(key);
  const updateLocal = () => {
    if (numeric && !validNumericControl(control)) return;
    const value = preferenceControlValue(control, key);
    pendingPreferences.set(key, value);
    applyPreferences({ ...currentPreferences, [key]: value });
    return { key, value };
  };
  control.addEventListener('input', updateLocal);
  // Persist on commit; the paired width controls and slider drag share one exact value.
  control.addEventListener('change', () => {
    if (numeric && !validNumericControl(control)) {
      applyPreferences(currentPreferences);
      return;
    }
    const preference = updateLocal();
    if (preference) vscode.postMessage({ type: 'preference', ...preference });
  });
});
document.getElementById('rmp-ui-toggle-outline')!.addEventListener('click', (event) => {
  const hidden = document.body.classList.toggle('hide-outline');
  (event.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!hidden));
});
content.addEventListener('click', (event) => {
  const element = event.target as HTMLElement;
  const imageAction = element.closest<HTMLButtonElement>('[data-external-image-action]');
  if (imageAction) {
    event.preventDefault();
    const origin = imageAction.dataset.externalImageOrigin;
    const action = imageAction.dataset.externalImageAction;
    if (!origin || (action !== 'grant' && action !== 'revoke')) return;
    rememberPermissionFocus();
    vscode.postMessage({
      type: action === 'grant' ? 'grantExternalImageOrigin' : 'revokeExternalImageOrigin',
      origin,
    });
    return;
  }
  const copy = element.closest<HTMLButtonElement>('.copy-code');
  if (copy) {
    document.getElementById('rmp-ui-announcement')!.textContent = 'Copying code…';
    vscode.postMessage({ type: 'copy', text: copy.closest('.code-block')?.querySelector('code')?.textContent ?? '' });
    return;
  }
  const link = element.closest<HTMLAnchorElement>('a');
  if (link?.dataset.referenceId) {
    event.preventDefault();
    vscode.postMessage({ type: 'reference', id: link.dataset.referenceId });
    return;
  }
  if (link) {
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      scrollToHeading(
        href.slice(1),
        link.closest('.footnote-ref') !== null || link.classList.contains('footnote-backref'),
      );
    } else vscode.postMessage({ type: 'link', href });
  }
});
// VS Code changes body classes when its theme changes without sending a preference message.
let lastVscodeTheme = document.body.className;
new MutationObserver(() => {
  const theme = document.body.className;
  if (theme !== lastVscodeTheme) reportAsync(diagrams(++revision));
  lastVscodeTheme = theme;
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('scroll', scheduleScrollState, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushScrollState();
});
window.addEventListener('pagehide', () => flushScrollState());
vscode.postMessage({ type: 'ready' });
