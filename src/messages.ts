import { numericPreferenceRanges } from './preference-ranges';
import { isExternalImageOrigin } from './external-images';
import { previewStyles } from './styles';
import type { OutlineItem } from './render';
import type { DocumentationFile } from './documentation';
import { tableCSV } from './tables';

// Limits count UTF-16 code units and apply before parsing or privileged operations.
export const messageLimits = {
  text: 4 * 1024 * 1024,
  uri: 8192,
  id: 8192,
  request: 80,
  html: 32 * 1024 * 1024,
  items: 100000,
  csvRows: 100000,
  csvColumns: 1000,
  csvCells: 1000000,
} as const;
export interface Preferences {
  style: string;
  appearance: string;
  contentWidth: number;
  fontSize: number;
  lineHeight: number;
  wrapCode: boolean;
}
export type DocumentationAction = 'open' | 'home' | 'refresh' | 'source' | 'back' | 'forward';
export type WebviewCommand =
  | { type: 'ready' }
  | { type: 'preference'; key: keyof Preferences; value: string | number | boolean }
  | { type: 'documentationAction'; action: DocumentationAction; id?: string }
  | { type: 'reference'; id: string }
  | { type: 'grantExternalImageOrigin' | 'revokeExternalImageOrigin'; origin: string }
  | { type: 'link'; href: string }
  | { type: 'copy'; text: string }
  | { type: 'tableCopy' | 'tableExport'; text: string; filename: string };
export type WebviewMessage =
  { type: 'ready' } | (Exclude<WebviewCommand, { type: 'ready' }> & { requestId: string; renderId: string });
export type HostMessage =
  | {
      type: 'render';
      html: string;
      outline: OutlineItem[];
      preferences: Preferences;
      documentId?: string;
      renderId?: string;
      documentationHome?: boolean;
      fragment?: string;
    }
  | { type: 'preferences'; preferences: Preferences }
  | {
      type: 'documentation';
      files: DocumentationFile[];
      loading: boolean;
      error?: string;
      active?: string;
      canBack: boolean;
      canForward: boolean;
    }
  | { type: 'copyResult'; requestId: string; success: boolean }
  | {
      type: 'tableActionResult';
      requestId: string;
      action: 'tableCopy' | 'tableExport';
      success?: boolean;
      cancelled?: boolean;
      error?: string;
    };
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.entries(Object.getOwnPropertyDescriptors(value)).every(
      ([key, descriptor]) => !['__proto__', 'prototype', 'constructor'].includes(key) && 'value' in descriptor,
    )
  );
}
function text(value: unknown, max: number, allowWhitespace = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !controls.test(value) &&
    (allowWhitespace || !/[\r\n\t]/.test(value))
  );
}
function id(value: unknown): value is string {
  return (
    text(value, messageLimits.id) && value.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(value)
  );
}
export function validPreference(key: unknown, value: unknown): boolean {
  if (key === 'style') return previewStyles.some((style) => style.id === value);
  if (key === 'appearance') return ['auto', 'light', 'dark'].includes(value as string);
  if (key === 'wrapCode') return typeof value === 'boolean';
  if (typeof key !== 'string' || !Object.hasOwn(numericPreferenceRanges, key)) return false;
  const [min, max] = numericPreferenceRanges[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function requestId(value: unknown): value is string {
  return text(value, messageLimits.request) && /^[a-zA-Z0-9_-]+$/.test(value);
}
function preferences(value: unknown): value is Preferences {
  return (
    plainRecord(value) &&
    Object.keys(value).length === 6 &&
    ['style', 'appearance', 'wrapCode', 'contentWidth', 'fontSize', 'lineHeight'].every((key) =>
      validPreference(key, value[key]),
    )
  );
}
export function validLink(value: unknown): value is string {
  if (
    !text(value, messageLimits.uri) ||
    !value ||
    value.trim() !== value ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return false;
  let decoded: string;
  try {
    const [path, ...fragments] = value.split('#');
    decoded = decodeURIComponent(path);
    const fragment = fragments.join('#');
    let decodedFragment: string;
    try {
      decodedFragment = decodeURIComponent(fragment);
    } catch {
      decodedFragment = fragment;
    }
    if (!text(decodedFragment, messageLimits.uri) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(fragment)) return false;
  } catch {
    return false;
  }
  if (!text(decoded, messageLimits.uri) || decoded.startsWith('//') || decoded.includes('\\')) return false;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(decoded)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (!['https', 'http', 'mailto'].includes(scheme)) return false;
  if (scheme !== 'mailto' && !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return scheme === 'mailto' ? !!url.pathname : !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
/** Validate the exact supported surface; future operations must add an explicit branch. */
export function validateWebviewMessage(value: unknown): value is WebviewMessage {
  if (!plainRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'ready') return Object.keys(value).every((key) => key === 'type');
  if (!text(value.requestId, messageLimits.request) || !/^[a-zA-Z0-9_-]+$/.test(value.requestId) || !id(value.renderId))
    return false;
  let fields: string[];
  switch (value.type) {
    case 'preference':
      if (!validPreference(value.key, value.value)) return false;
      fields = ['key', 'value'];
      break;
    case 'documentationAction':
      if (
        !['open', 'home', 'refresh', 'source', 'back', 'forward'].includes(value.action as string) ||
        (value.action === 'open' ? !id(value.id) : value.id !== undefined)
      )
        return false;
      fields = ['action', 'id'];
      break;
    case 'grantExternalImageOrigin':
    case 'revokeExternalImageOrigin':
      if (!isExternalImageOrigin(value.origin)) return false;
      fields = ['origin'];
      break;
    case 'reference':
      if (!id(value.id)) return false;
      fields = ['id'];
      break;
    case 'link':
      if (!validLink(value.href)) return false;
      fields = ['href'];
      break;
    case 'copy':
      if (!text(value.text, messageLimits.text, true)) return false;
      fields = ['text'];
      break;
    case 'tableCopy':
    case 'tableExport':
      if (
        !text(value.text, messageLimits.text, true) ||
        typeof value.filename !== 'string' ||
        !/^table-[1-9]\d{0,8}\.csv$/.test(value.filename) ||
        normalizeCSV(value.text) === undefined
      )
        return false;
      fields = ['text', 'filename'];
      break;
    default:
      return false;
  }
  return Object.keys(value).every((key) => ['type', 'requestId', 'renderId', ...fields].includes(key));
}
/** Parse the quoted CSV emitted by tableCSV and reapply formula escaping at the host. */
export function normalizeCSV(value: string): string | undefined {
  if (!text(value, messageLimits.text, true)) return undefined;
  const rows: string[][] = [];
  let row: string[] = [];
  let cursor = 0;
  let cells = 0;
  while (cursor < value.length) {
    if (value[cursor++] !== '"') return undefined;
    let cell = '';
    let closed = false;
    while (cursor < value.length) {
      const char = value[cursor++];
      if (char !== '"') {
        cell += char;
        continue;
      }
      if (value[cursor] === '"') {
        cell += '"';
        cursor++;
      } else {
        closed = true;
        break;
      }
    }
    if (!closed) return undefined;
    if (++cells > messageLimits.csvCells || row.length >= messageLimits.csvColumns) return undefined;
    row.push(cell);
    if (value[cursor] === ',') {
      cursor++;
      if (cursor === value.length) return undefined;
      continue;
    }
    if (value.slice(cursor, cursor + 2) !== '\r\n') return undefined;
    cursor += 2;
    if (rows.length >= messageLimits.csvRows) return undefined;
    rows.push(row);
    row = [];
  }
  if (!rows.length || row.length) return undefined;
  const normalized = tableCSV(rows);
  return normalized.length <= messageLimits.text ? normalized : undefined;
}
export function validateHostMessage(value: unknown): value is HostMessage {
  if (!plainRecord(value)) return false;
  switch (value.type) {
    case 'preferences':
      return preferences(value.preferences);
    case 'copyResult':
      return requestId(value.requestId) && typeof value.success === 'boolean';
    case 'tableActionResult':
      return (
        requestId(value.requestId) &&
        ['tableCopy', 'tableExport'].includes(value.action as string) &&
        ((typeof value.success === 'boolean' && value.cancelled === undefined) ||
          (value.cancelled === true && value.success === undefined)) &&
        (value.error === undefined || text(value.error, 8192))
      );
    case 'documentation':
      return (
        Array.isArray(value.files) &&
        value.files.length <= messageLimits.items &&
        value.files.every(
          (file) => plainRecord(file) && ['id', 'root', 'rootName', 'path'].every((key) => id(file[key])),
        ) &&
        typeof value.loading === 'boolean' &&
        typeof value.canBack === 'boolean' &&
        typeof value.canForward === 'boolean' &&
        (value.active === undefined || id(value.active)) &&
        (value.error === undefined || text(value.error, 8192))
      );
    case 'render':
      return (
        text(value.html, messageLimits.html, true) &&
        preferences(value.preferences) &&
        (value.renderId === undefined || id(value.renderId)) &&
        (value.documentId === undefined || id(value.documentId)) &&
        (value.documentationHome === undefined || typeof value.documentationHome === 'boolean') &&
        (value.fragment === undefined || text(value.fragment, messageLimits.uri)) &&
        Array.isArray(value.outline) &&
        value.outline.length <= messageLimits.items &&
        value.outline.every(
          (item) =>
            plainRecord(item) &&
            id(item.id) &&
            text(item.fragment, messageLimits.uri) &&
            text(item.text, messageLimits.uri, true) &&
            Number.isInteger(item.level) &&
            Number(item.level) >= 1 &&
            Number(item.level) <= 6,
        )
      );
    default:
      return false;
  }
}

export function validateRestoredState(value: unknown): boolean {
  if (
    !plainRecord(value) ||
    !Object.keys(value).every((key) =>
      ['scroll', 'tables', 'disclosures', 'documentation', 'documentId', 'documents', 'permissionFocus'].includes(key),
    )
  )
    return false;
  if (value.permissionFocus !== undefined) {
    const focus = value.permissionFocus;
    if (
      !plainRecord(focus) ||
      !Object.keys(focus).every((key) => ['key', 'documentId', 'selection'].includes(key)) ||
      !id(focus.key) ||
      (focus.documentId !== undefined && !id(focus.documentId))
    )
      return false;
    const selection = focus.selection;
    if (
      selection !== undefined &&
      (!Array.isArray(selection) ||
        selection.length !== 3 ||
        !Number.isSafeInteger(selection[0]) ||
        !Number.isSafeInteger(selection[1]) ||
        selection[0] < 0 ||
        selection[1] < selection[0] ||
        !['forward', 'backward', 'none'].includes(selection[2]))
    )
      return false;
  }
  const record = (entry: unknown, check: (item: unknown) => boolean) =>
    plainRecord(entry) &&
    Object.keys(entry).length <= 10000 &&
    Object.entries(entry).every(([key, item]) => text(key, messageLimits.id) && check(item));
  const reading = (entry: unknown): boolean =>
    plainRecord(entry) &&
    (entry.scroll === undefined ||
      (typeof entry.scroll === 'number' && Number.isFinite(entry.scroll) && entry.scroll >= 0)) &&
    (entry.disclosures === undefined || record(entry.disclosures, (item) => typeof item === 'boolean')) &&
    (entry.tables === undefined ||
      record(
        entry.tables,
        (item) =>
          plainRecord(item) &&
          Object.keys(item).every((key) => ['query', 'column', 'direction', 'density'].includes(key)) &&
          text(item.query, messageLimits.uri, true) &&
          Number.isInteger(item.column) &&
          Number(item.column) >= 0 &&
          ['none', 'ascending', 'descending'].includes(item.direction as string) &&
          ['comfortable', 'compact'].includes(item.density as string),
      ));
  return (
    reading(value) &&
    (value.documentId === undefined || id(value.documentId)) &&
    (value.documents === undefined ||
      record(
        value.documents,
        (item) =>
          plainRecord(item) &&
          Object.keys(item).every((key) => ['scroll', 'tables', 'disclosures'].includes(key)) &&
          reading(item),
      )) &&
    (value.documentation === undefined ||
      (plainRecord(value.documentation) &&
        Object.keys(value.documentation).every((key) => ['expanded', 'filter', 'outline'].includes(key)) &&
        (value.documentation.expanded === undefined ||
          (Array.isArray(value.documentation.expanded) &&
            value.documentation.expanded.length <= 10000 &&
            value.documentation.expanded.every(id))) &&
        (value.documentation.filter === undefined || text(value.documentation.filter, messageLimits.uri, true)) &&
        (value.documentation.outline === undefined || typeof value.documentation.outline === 'boolean')))
  );
}
