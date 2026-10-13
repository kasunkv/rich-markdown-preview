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
