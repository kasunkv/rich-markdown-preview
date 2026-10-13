import type { TableState } from './tables';
import { plainRecord, validateRestoredState } from './messages';

export interface ReadingState {
  scroll?: number;
  tables?: TableState;
  disclosures?: Record<string, boolean>;
}

export interface PersistedReadingState extends ReadingState {
  readingStateVersion: 1;
  documentId?: string;
  documents: Record<string, ReadingState>;
  documentOrder: string[];
  documentation?: { expanded?: string[]; filter?: string; outline?: boolean };
  permissionFocus?: { key: string; documentId?: string; selection?: [number, number, 'forward' | 'backward' | 'none'] };
  session?: SessionMetadata;
}

export interface SessionMetadata {
  version: 1;
  kind: 'preview' | 'documentation';
  target?: string;
  workspaceRoot?: string;
  history: string[];
  cursor: number;
}

// The byte cap includes document IDs, interaction keys, search text and JSON punctuation.
export const readingStateLimits = {
  bytes: 65536,
  documents: 24,
  tablesPerDocument: 24,
  disclosuresPerDocument: 64,
  expandedDirectories: 128,
  keyLength: 512,
  documentIdLength: 8192,
  filterLength: 512,
  navigationHistory: 64,
  restoredHistory: 20,
} as const;

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const safeKey = (key: string) =>
  key !== '__proto__' && key !== 'constructor' && key !== 'prototype' && key.length <= readingStateLimits.keyLength;
const safeDocumentId = (id: string) =>
  id !== '__proto__' && id !== 'constructor' && id !== 'prototype' && id.length <= readingStateLimits.documentIdLength;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const uri = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= readingStateLimits.documentIdLength &&
  !/[\u0000-\u0020\u007f]/.test(value);

/** Inspect descriptors before validators touch nested arrays or records. */
function plainDataTree(root: unknown): boolean {
  const stack: { value: unknown; exit?: boolean }[] = [{ value: root }];
  const active = new WeakSet<object>();
  const done = new WeakSet<object>();
  let visited = 0;
  while (stack.length) {
    const { value, exit } = stack.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (exit) {
      active.delete(value);
      done.add(value);
      continue;
    }
    if (active.has(value)) return false;
    if (done.has(value)) continue;
    if (++visited > 100000) return false;
    active.add(value);
    stack.push({ value, exit: true });
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)))
      return false;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || keys.length !== length + 1) return false;
      for (let index = 0; index < length; index++) if (!Object.hasOwn(descriptors, String(index))) return false;
    }
    for (const descriptor of Object.values(descriptors)) {
      if (!('value' in descriptor)) return false;
      stack.push({ value: descriptor.value });
    }
  }
  return true;
}

/** Session context is retained as data only; the host must independently authorize each URI. */
function readSession(value: unknown): SessionMetadata | undefined {
  if (!plainRecord(value)) return undefined;
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' || !['version', 'kind', 'target', 'workspaceRoot', 'history', 'cursor'].includes(key),
    ) ||
    value.version !== 1 ||
    !['preview', 'documentation'].includes(value.kind as string) ||
    (value.target !== undefined && !uri(value.target)) ||
    (value.workspaceRoot !== undefined && !uri(value.workspaceRoot)) ||
    (value.kind === 'preview' && value.target === undefined) ||
    !Array.isArray(value.history) ||
    Object.getPrototypeOf(value.history) !== Array.prototype ||
    value.history.length > readingStateLimits.restoredHistory
  )
    return undefined;
  const history: string[] = [];
  for (let index = 0; index < value.history.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.history, String(index));
    if (!descriptor || !('value' in descriptor) || !uri(descriptor.value)) return undefined;
    history.push(descriptor.value);
  }
  const cursor = value.cursor;
  if (!Number.isInteger(cursor) || (cursor as number) < -1 || (cursor as number) >= history.length) return undefined;
  if (history.length && history[cursor as number] !== value.target) return undefined;
  if (!history.length && cursor !== -1) return undefined;
  return {
    version: 1,
    kind: value.kind as SessionMetadata['kind'],
    target: value.target as string | undefined,
    workspaceRoot: value.workspaceRoot as string | undefined,
    history,
    cursor: cursor as number,
  };
}

function trimRecord<T>(record: Record<string, T> | undefined, limit: number): Record<string, T> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => safeKey(key))
      .slice(-limit),
  );
}

function trimReading(reading: ReadingState): ReadingState {
  return {
    scroll: reading.scroll,
    tables: trimRecord(reading.tables, readingStateLimits.tablesPerDocument),
    disclosures: trimRecord(reading.disclosures, readingStateLimits.disclosuresPerDocument),
  };
}

/** Keep the active document and most recently used visits; evict older detail before the active position. */
export function boundReadingState(
  state: PersistedReadingState,
  liveDocuments?: ReadonlySet<string>,
  liveDirectories?: ReadonlySet<string>,
): PersistedReadingState {
  const documents: Record<string, ReadingState> = Object.create(null);
  const active = state.documentId && safeDocumentId(state.documentId) ? state.documentId : undefined;
  const retained = (id: string) =>
    safeDocumentId(id) && own(state.documents, id) && (!liveDocuments || liveDocuments.has(id) || id === active);
  const order = [...new Set(state.documentOrder)].filter(retained);
  const known = new Set(order);
  for (const id of Object.keys(state.documents))
    if (retained(id) && !known.has(id)) {
      order.unshift(id);
      known.add(id);
    }
  if (active && own(state.documents, active)) {
    order.splice(order.indexOf(active), 1);
    order.push(active);
  }
  const recent = order.slice(-readingStateLimits.documents);
  for (const id of recent) documents[id] = trimReading(state.documents[id]);
  const result: PersistedReadingState = {
    readingStateVersion: 1,
    documentId: active,
    documents,
    documentOrder: recent,
    ...trimReading(state),
    documentation: state.documentation && {
      expanded: [...new Set(state.documentation.expanded ?? [])]
        .filter((id) => safeKey(id) && (!liveDirectories || liveDirectories.has(id.replace(/^closed:/, ''))))
        .slice(-readingStateLimits.expandedDirectories),
      filter: state.documentation.filter?.slice(0, readingStateLimits.filterLength),
      outline: state.documentation.outline,
    },
    permissionFocus: state.permissionFocus,
    session: state.session && { ...state.session, history: [...state.session.history] },
  };
  while (bytes(result) > readingStateLimits.bytes && result.documentOrder.some((id) => id !== active)) {
    const oldest = result.documentOrder.find((id) => id !== active)!;
    result.documentOrder.splice(result.documentOrder.indexOf(oldest), 1);
    delete result.documents[oldest];
  }
  while (bytes(result) > readingStateLimits.bytes && result.documentation?.expanded?.length)
    result.documentation.expanded.shift();
  if (bytes(result) > readingStateLimits.bytes && result.session) result.session.workspaceRoot = undefined;
  // Trim the farthest navigation entry first, keeping the selected target and nearby Back/Forward entries.
  while (bytes(result) > readingStateLimits.bytes && result.session && result.session.history.length > 1) {
    const session = result.session;
    const before = session.cursor;
    const after = session.history.length - 1 - session.cursor;
    if (before >= after && before > 0) {
      session.history.shift();
      session.cursor--;
    } else session.history.pop();
  }
  if (bytes(result) > readingStateLimits.bytes && result.session?.history.length) {
    result.session.history = [];
    result.session.cursor = -1;
  }
  // A huge single document can exceed the cap even after older visits are removed.
  const reduce = (reading: ReadingState) => {
    while (bytes(result) > readingStateLimits.bytes && Object.keys(reading.disclosures ?? {}).length)
      delete reading.disclosures![Object.keys(reading.disclosures!)[0]];
    while (bytes(result) > readingStateLimits.bytes && Object.keys(reading.tables ?? {}).length)
      delete reading.tables![Object.keys(reading.tables!)[0]];
  };
  if (active && result.documents[active]) reduce(result.documents[active]);
  reduce(result);
  if (bytes(result) > readingStateLimits.bytes && result.documentation) result.documentation.filter = '';
  if (bytes(result) > readingStateLimits.bytes) result.permissionFocus = undefined;
  if (bytes(result) > readingStateLimits.bytes) result.session = undefined;
  // An exceptionally long multibyte URI can exceed the cap when repeated as ID, map key and order entry.
  // Keep the active top-level ID and scroll, dropping its duplicate visit entry only as a last resort.
  if (bytes(result) > readingStateLimits.bytes && active) {
    delete result.documents[active];
    result.documentOrder = result.documentOrder.filter((id) => id !== active);
  }
  return result;
}

/** Migrate validated legacy VS Code webview state; malformed and future formats start empty. */
export function restoreReadingState(raw: unknown): PersistedReadingState {
  const empty: PersistedReadingState = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  try {
    // Inspect own data descriptors before reading metadata or spreading the saved record.
    if (!plainDataTree(raw) || !plainRecord(raw)) return empty;
    const value = raw;
    if (value.readingStateVersion !== undefined && value.readingStateVersion !== 1) return empty;
    let order: string[];
    if (value.readingStateVersion === 1) {
      const savedOrder = value.documentOrder;
      if (
        !Array.isArray(savedOrder) ||
        Object.getPrototypeOf(savedOrder) !== Array.prototype ||
        !Object.values(Object.getOwnPropertyDescriptors(savedOrder)).every((descriptor) => 'value' in descriptor) ||
        savedOrder.length > 10000 ||
        !savedOrder.every((id) => typeof id === 'string' && safeDocumentId(id))
      )
        return empty;
      order = savedOrder;
    } else {
      order = Object.keys((value.documents as object | undefined) ?? {});
    }
    const { readingStateVersion: _version, documentOrder: _order, session: rawSession, ...legacy } = value;
    if (!validateRestoredState(legacy)) return empty;
    const session = rawSession === undefined ? undefined : readSession(rawSession);
    return boundReadingState({
      ...(legacy as unknown as PersistedReadingState),
      documents: (legacy.documents as Record<string, ReadingState> | undefined) ?? {},
      readingStateVersion: 1,
      documentOrder: order,
      session,
    });
  } catch {
    // Malformed proxies, cyclic values or hostile nested records cannot break preview startup.
    return empty;
  }
}
