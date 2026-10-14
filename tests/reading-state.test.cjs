const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const filename = path.resolve(__dirname, '../src', name + '.ts');
  const mod = new Module(filename, module);
  cache.set(name, mod);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = target => target.startsWith('./') ? load(target.slice(2)) : require(target);
  const source = process.env.SOURCE_COVERAGE_ROOT
    ? require('../scripts/coverage-instrument.cjs').instrument(filename).code
    : fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const { boundReadingState, restoreReadingState, readingStateLimits } = load('reading-state');
const size = state => Buffer.byteLength(JSON.stringify(state), 'utf8');
const saved = state => JSON.parse(JSON.stringify(state));

test('a long visit sequence retains the current and most recent useful positions within the budget', () => {
  const documents = Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`file:///${index}.md`, { scroll: index * 10 }]));
  const order = Object.keys(documents);
  const state = boundReadingState({ readingStateVersion: 1, documentId: 'file:///37.md', documents, documentOrder: order });
  assert.ok(size(state) <= readingStateLimits.bytes);
  assert.ok(state.documentOrder.length <= readingStateLimits.documents);
  assert.equal(state.documents['file:///37.md'].scroll, 370);
  assert.equal(state.documents['file:///1199.md'].scroll, 11990);
  assert.equal(state.documents['file:///0.md'], undefined);
  assert.equal(state.documentOrder.at(-1), 'file:///37.md');
});

test('large interaction maps and multibyte text stay within the serialized byte cap', () => {
  const id = 'file:///active.md';
  const reading = {
    scroll: 9876,
    tables: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`table-${index}`, { query: '界'.repeat(1500), column: 0, direction: 'none', density: 'compact' }])),
    disclosures: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`disclosure-${index}`, index % 2 === 0])),
  };
  const state = boundReadingState({ readingStateVersion: 1, documentId: id, documents: { [id]: reading }, documentOrder: [id], ...reading,
    documentation: { expanded: Array.from({ length: 500 }, (_, index) => `folder-${index}`), filter: '界'.repeat(1000), outline: true } });
  assert.ok(size(state) <= readingStateLimits.bytes);
  assert.equal(state.documents[id].scroll, 9876);
  assert.equal(state.scroll, 9876);
  assert.equal(state.documentOrder.length, 1);
  assert.ok(Object.keys(state.documents[id].tables).length <= readingStateLimits.tablesPerDocument);
  assert.ok(Object.keys(state.documents[id].disclosures).length <= readingStateLimits.disclosuresPerDocument);
  assert.ok(state.documentation.expanded.length <= readingStateLimits.expandedDirectories);
});

test('stale documents and directory disclosures are removed without losing the active document', () => {
  const state = boundReadingState({ readingStateVersion: 1, documentId: 'active', documents: {
    active: { scroll: 90 }, back: { scroll: 10 }, deleted: { scroll: 20 } },
    documentOrder: ['back', 'deleted', 'active'], documentation: { expanded: ['root', 'closed:root/folder', 'removed'] } },
    new Set(['back']), new Set(['root', 'root/folder']));
  assert.deepEqual(state.documentOrder, ['back', 'active']);
  assert.deepEqual(state.documentation.expanded, ['root', 'closed:root/folder']);
  assert.equal(state.documents.deleted, undefined);
  assert.equal(state.documents.active.scroll, 90);
});

test('legacy state migrates while malformed and unknown versions fall back safely', () => {
  const legacy = { scroll: 18, documentId: 'file:///active.md', documents: {
    'file:///active.md': { scroll: 18 }, 'file:///back.md': { scroll: 4 } } };
  const migrated = restoreReadingState(legacy);
  assert.equal(migrated.readingStateVersion, 1);
  assert.equal(migrated.documents['file:///active.md'].scroll, 18);
  assert.equal(migrated.documentOrder.at(-1), 'file:///active.md');
  assert.equal(restoreReadingState(migrated).documents['file:///back.md'].scroll, 4);
  assert.deepEqual(restoreReadingState({ ...legacy, readingStateVersion: 2 }), { readingStateVersion: 1, documents: {}, documentOrder: [] });
  assert.deepEqual(restoreReadingState({ ...legacy, documents: { bad: { scroll: -1 } } }), { readingStateVersion: 1, documents: {}, documentOrder: [] });
  assert.deepEqual(restoreReadingState({ ...migrated, documentOrder: [42] }), { readingStateVersion: 1, documents: {}, documentOrder: [] });
});

test('valid legacy states without a documents map restore safely', () => {
  const empty = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  assert.deepEqual(saved(restoreReadingState({})), empty);
  assert.deepEqual(saved(restoreReadingState({ scroll: 18 })), { ...empty, scroll: 18 });
  assert.deepEqual(saved(restoreReadingState({ readingStateVersion: 1, documentOrder: [] })), empty);
});

test('accessors, inherited data and malformed nested records fall back without invoking getters', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'readingStateVersion', { enumerable: true, get() { reads++; throw Error('secret'); } });
  const inherited = Object.create({ scroll: 18 });
  const order = Object.defineProperty([], '0', { enumerable: true, get() { reads++; throw Error('secret'); } });
  const nested = { readingStateVersion: 1, documentOrder: [], documents: Object.defineProperty({}, 'file:///a.md', {
    enumerable: true, get() { reads++; throw Error('secret'); } }) };
  const expanded = Object.defineProperty([], '0', { enumerable: true, get() { reads++; return 'root'; } });
  const selection = Object.defineProperty([0, 0, 'none'], '0', { enumerable: true, get() { reads++; return 0; } });
  const empty = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  assert.deepEqual(restoreReadingState(accessor), empty);
  assert.deepEqual(restoreReadingState(inherited), empty);
  assert.deepEqual(restoreReadingState({ readingStateVersion: 1, documentOrder: order }), empty);
  assert.deepEqual(restoreReadingState(nested), empty);
  assert.deepEqual(restoreReadingState({ readingStateVersion: 1, documents: {}, documentOrder: [], documentation: { expanded } }), empty);
  assert.deepEqual(restoreReadingState({ permissionFocus: { key: 'focus', selection } }), empty);
  assert.equal(reads, 0);
});

test('a validated reload session shares the byte cap without authorizing or losing the active target', () => {
  const target = 'file:///active.md';
  const history = Array.from({ length: 20 }, (_, index) => `file:///docs/${index}-${'a'.repeat(4000)}.md`);
  history[10] = target;
  const restored = restoreReadingState({ readingStateVersion: 1, documentId: target,
    documents: { [target]: { scroll: 321 } }, documentOrder: [target], permissionFocus: { key: 'search', documentId: target },
    session: { version: 1, kind: 'documentation', target, workspaceRoot: 'file:///docs', history, cursor: 10 } });
  assert.ok(size(restored) <= readingStateLimits.bytes);
  assert.equal(restored.documents[target].scroll, 321);
  assert.equal(restored.permissionFocus.key, 'search');
  assert.equal(restored.session.history[restored.session.cursor], target);
  assert.ok(restored.session.history.length < 20);
  assert.equal(restoreReadingState({ ...restored, session: { ...restored.session, admin: true } }).session, undefined);
});

test('a long valid document URI remains the active reading position', () => {
  const id = `file:///docs/${'a'.repeat(3000)}.md`;
  const state = restoreReadingState({ documentId: id, documents: { [id]: { scroll: 410 } } });
  assert.equal(state.documents[id].scroll, 410);
  assert.equal(state.documentId, id);
  assert.ok(size(state) <= readingStateLimits.bytes);
});

test('multibyte session URIs cannot exceed the complete persisted envelope budget', () => {
  const target = `file:///${'界'.repeat(8180)}`;
  const state = restoreReadingState({ readingStateVersion: 1, documents: {}, documentOrder: [],
    session: { version: 1, kind: 'preview', target, workspaceRoot: target, history: [target], cursor: 0 } });
  assert.ok(size(state) <= readingStateLimits.bytes, `state used ${size(state)} bytes`);
  assert.equal(state.session?.target, target);
  assert.equal(state.session?.workspaceRoot, undefined);
});

test('a structured-cloned state may share table objects without being cyclic', () => {
  const tables = { first: { query: 'guide', column: 0, direction: 'none', density: 'comfortable' } };
  const state = restoreReadingState({ readingStateVersion: 1, documentId: 'file:///guide.md', documentOrder: ['file:///guide.md'],
    tables, documents: { 'file:///guide.md': { scroll: 20, tables } } });
  assert.equal(state.documents['file:///guide.md'].tables.first.query, 'guide');
});

test('the byte cap evicts oldest bulky visits while preserving the active reading context', () => {
  const documents = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`file:///chapter${index}.md`, {
    scroll: index * 100, tables: { search: { query: '界'.repeat(4000), column: 0, direction: 'none', density: 'compact' } },
  }]));
  const state = boundReadingState({ readingStateVersion: 1, documentId: 'file:///chapter23.md',
    documents, documentOrder: Object.keys(documents), scroll: 2300 });
  assert.ok(size(state) <= readingStateLimits.bytes);
  assert.equal(state.documents['file:///chapter23.md'].scroll, 2300);
  assert.equal(state.documents['file:///chapter0.md'], undefined);
  assert.ok(state.documentOrder.length < 24);
});

test('extreme active URI length keeps top-level scroll after optional context is exhausted', () => {
  const target = `file:///${'界'.repeat(8180)}`;
  const state = restoreReadingState({ readingStateVersion: 1, documentId: target, scroll: 480,
    documents: { [target]: { scroll: 480 } }, documentOrder: [target],
    documentation: { filter: '界'.repeat(2500) }, permissionFocus: { key: '界'.repeat(8000), documentId: target },
    session: { version: 1, kind: 'preview', target, workspaceRoot: target, history: [target], cursor: 0 } });
  assert.ok(size(state) <= readingStateLimits.bytes);
  assert.equal(state.documentId, target);
  assert.equal(state.scroll, 480);
  assert.equal(state.documents[target], undefined);
});

test('malformed session metadata and cyclic restored maps fall back without navigation authority', () => {
  const empty = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  const cyclic = { documents: {} }; cyclic.documents.self = cyclic;
  assert.deepEqual(restoreReadingState(cyclic), empty);
  const reading = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  assert.equal(restoreReadingState({ ...reading, session: null }).session, undefined);
  assert.equal(restoreReadingState({ ...reading, session: { version: 1, kind: 'preview', target: 'file:///a.md',
    history: ['file:///b.md'], cursor: 0 } }).session, undefined);
  assert.equal(restoreReadingState({ ...reading, session: { version: 1, kind: 'preview', target: 'file:///a.md',
    history: ['file:///a.md'], cursor: 2 } }).session, undefined);
});

test('legacy unordered back positions survive migration behind the active visit', () => {
  const state = restoreReadingState({ documentId: 'file:///current.md', scroll: 90, documents: {
    'file:///older.md': { scroll: 12 }, 'file:///current.md': { scroll: 90 },
    'file:///unlisted.md': { scroll: 44 },
  } });
  assert.equal(state.documentOrder.at(-1), 'file:///current.md');
  assert.equal(state.documents['file:///older.md'].scroll, 12);
  assert.equal(state.documents['file:///unlisted.md'].scroll, 44);
  assert.ok(size(state) <= readingStateLimits.bytes);
});

test('a partially recorded versioned order retains other readable Back positions', () => {
  const state = restoreReadingState({ readingStateVersion: 1, documentId: 'file:///current.md',
    documentOrder: ['file:///current.md'], documents: {
      'file:///older.md': { scroll: 12 }, 'file:///current.md': { scroll: 90 },
      'file:///unlisted.md': { scroll: 44 },
    } });
  assert.equal(state.documentOrder.at(-1), 'file:///current.md');
  assert.ok(state.documentOrder.includes('file:///older.md'));
  assert.ok(state.documentOrder.includes('file:///unlisted.md'));
  assert.equal(state.documents['file:///older.md'].scroll, 12);
  assert.equal(state.documents['file:///unlisted.md'].scroll, 44);
});

test('reload session pruning keeps selected target and adjacent Back and Forward context', () => {
  const target = 'file:///chapter10.md';
  const history = Array.from({ length: 20 }, (_, index) => `file:///chapter${index}-${'a'.repeat(4000)}.md`);
  history[10] = target;
  const state = restoreReadingState({ readingStateVersion: 1, documents: {}, documentOrder: [],
    session: { version: 1, kind: 'documentation', target, workspaceRoot: 'file:///docs', history, cursor: 10 } });
  assert.ok(size(state) <= readingStateLimits.bytes);
  assert.equal(state.session.history[state.session.cursor], target);
  assert.ok(state.session.history.length > 1);
  assert.ok(state.session.history.some(id => id.includes('chapter9-')));
  assert.ok(state.session.history.some(id => id.includes('chapter11-')));
});

test('malformed arrays and session cursors fall back without reading accessor values', () => {
  let getterReads = 0;
  const empty = { readingStateVersion: 1, documents: {}, documentOrder: [] };
  const sparse = { ...empty, documentOrder: new Array(2) };
  const cyclic = []; cyclic.push(cyclic);
  const getter = Object.defineProperty(['file:///a.md'], '0', { get() { getterReads++; return 'file:///a.md'; } });
  assert.deepEqual(restoreReadingState(sparse), empty);
  assert.deepEqual(restoreReadingState({ ...empty, documentOrder: cyclic }), empty);
  assert.deepEqual(restoreReadingState({ ...empty, documentOrder: getter }), empty);
  assert.equal(getterReads, 0);
  const session = { version: 1, kind: 'preview', target: 'file:///a.md', history: ['file:///a.md'], cursor: -1 };
  assert.equal(restoreReadingState({ ...empty, session }).session, undefined);
  assert.equal(restoreReadingState({ ...empty, session: { ...session, history: [], cursor: 0 } }).session, undefined);
});
