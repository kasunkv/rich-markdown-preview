const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { instrument } = require('../scripts/coverage-instrument.cjs');
let loaded;
async function helpers() {
  return loaded ??= (async () => {
    const result = await esbuild.build({ entryPoints: ['src/render-work.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{name:'source', setup(build) { build.onLoad({filter:/\.ts$/}, args => ({contents:instrument(args.path).code,loader:'ts'})); }}] });
    const module = {exports:{}};
    vm.runInNewContext(result.outputFiles[0].text, {module, exports:module.exports, __coverage__:globalThis.__coverage__ ??= {}});
    return module.exports;
  })();
}
test('cache bounds include source keys, reject malformed sizes, and evict least recently used entries', async () => {
  const { RenderCache } = await helpers();
  for (const [entries, units] of [[0,1],[1,0],[NaN,1],[1,Infinity],[1.5,2]]) assert.throws(() => new RenderCache(entries,units), /bounds/);
  const cache = new RenderCache(2,10);
  assert.equal(cache.get('missing'),undefined);
  assert.equal(cache.set('a','first',3),true);
  cache.set('b','second',3);
  assert.equal(cache.get('a'),'first');
  cache.set('c','third',3);
  assert.equal(cache.get('b'),undefined);
  assert.equal(cache.size,2);
  assert.equal(cache.retainedUnits,8);
  cache.set('a','replacement',0);
  assert.equal(cache.get('a'),'replacement');
  assert.equal(cache.retainedUnits,5);
  cache.set('longkey','large',3);
  assert.equal(cache.size,1);
  for (const units of [-1,NaN,Infinity,1.2,Number.MAX_SAFE_INTEGER]) assert.equal(cache.set('bad','no',units),false);
  assert.equal(cache.set('longkey','oversized replacement',100),false);
  assert.equal(cache.get('longkey'),undefined);
  cache.delete('absent');
  cache.set('x','x',0); cache.clear();
  assert.equal(cache.size,0); assert.equal(cache.retainedUnits,0);
});
test('exact source, version, URI and every policy context isolate cache entries', async () => {
  const {documentRenderKey, diagramRenderKey} = await helpers();
  const key = documentRenderKey('file:a',1,'hello','trusted|grant:a');
  for (const args of [['file:b',1,'hello','trusted|grant:a'],['file:a',2,'hello','trusted|grant:a'],['file:a',1,'world','trusted|grant:a'],['file:a',1,'hello','restricted']]) assert.notEqual(documentRenderKey(...args),key);
  assert.notEqual(diagramRenderKey('graph A','dark','strict'), diagramRenderKey('graph A','light','strict'));
  assert.notEqual(diagramRenderKey('graph A','dark','strict'), diagramRenderKey('graph B','dark','strict'));
  assert.notEqual(diagramRenderKey('graph A','dark','strict'), diagramRenderKey('graph A','dark','new-renderer'));
  assert.notEqual(diagramRenderKey('a","b','c','d'),diagramRenderKey('a','b","c','d'));
});
test('rapid edit/theme requests and hidden work cannot commit stale content; unchanged reveal needs no render', async () => {
  const {RenderWork} = await helpers();
  const work = new RenderWork();
  assert.equal(work.needsRender('one'),true);
  const first = work.request(), newest = work.request();
  assert.equal(work.delivered('stale',first),false);
  assert.equal(work.delivered('one',newest),true);
  assert.equal(work.needsRender('one'),false);
  const hiddenRequest = work.request(); work.setVisible(false);
  assert.equal(work.current(hiddenRequest),false); assert.equal(work.needsRender('two'),false);
  work.setVisible(false); work.setVisible(true);
  assert.equal(work.delivered('two',hiddenRequest),false);
  assert.equal(work.needsRender('one'),false);
  assert.equal(work.needsRender('two'),true);
  const themeRequest = work.request(); assert.equal(work.delivered('two',themeRequest),true);
  work.reset(); assert.equal(work.current(themeRequest),false); assert.equal(work.needsRender('two'),true);
});
