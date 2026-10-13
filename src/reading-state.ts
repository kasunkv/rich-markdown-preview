import type { TableState } from './tables';
import { validateRestoredState } from './messages';

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
}

// The byte cap includes document IDs, interaction keys, search text and JSON punctuation.
export const readingStateLimits = {
  bytes: 65536,
  documents: 24,
  tablesPerDocument: 24,
  disclosuresPerDocument: 64,
  expandedDirectories: 128,
  keyLength: 512,
  filterLength: 512,
  navigationHistory: 64,
} as const;

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const safeKey = (key: string) =>
  key !== '__proto__' && key !== 'constructor' && key !== 'prototype' && key.length <= readingStateLimits.keyLength;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

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
  const active = state.documentId && safeKey(state.documentId) ? state.documentId : undefined;
  const retained = (id: string) =>
    safeKey(id) && own(state.documents, id) && (!liveDocuments || liveDocuments.has(id) || id === active);
  const order = [...new Set(state.documentOrder)].filter(retained);
  const known = new Set(order);
  for (const id of Object.keys(state.documents))
    if (retained(id) && !known.has(id)) {
      order.unshift(id);
      known.add(id);
    }
  if (state.documentId && safeKey(state.documentId) && own(state.documents, state.documentId)) {
    order.splice(order.indexOf(state.documentId), 1);
    order.push(state.documentId);
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
  };
  while (bytes(result) > readingStateLimits.bytes && result.documentOrder.some((id) => id !== active)) {
    const oldest = result.documentOrder.find((id) => id !== active)!;
    result.documentOrder.splice(result.documentOrder.indexOf(oldest), 1);
    delete result.documents[oldest];
  }
  while (bytes(result) > readingStateLimits.bytes && result.documentation?.expanded?.length)
    result.documentation.expanded.shift();
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
  return result;
}

/** Migrate validated legacy VS Code webview state; malformed and future formats start empty. */
export function restoreReadingState(raw: unknown): PersistedReadingState {
  const empty: PersistedReadingState = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const value = raw as Record<string, unknown>;
  if (value.readingStateVersion !== undefined && value.readingStateVersion !== 1) return empty;
  let order: string[];
  if (value.readingStateVersion === 1) {
    if (
      !Array.isArray(value.documentOrder) ||
      value.documentOrder.length > 10000 ||
      !value.documentOrder.every((id) => typeof id === 'string' && safeKey(id))
    )
      return empty;
    order = value.documentOrder;
  } else {
    order = Object.keys((value.documents as object | undefined) ?? {});
  }
  const { readingStateVersion: _version, documentOrder: _order, ...legacy } = value;
  if (!validateRestoredState(legacy)) return empty;
  return boundReadingState({
    ...(legacy as unknown as PersistedReadingState),
    readingStateVersion: 1,
    documentOrder: order,
  });
}
