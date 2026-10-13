const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
const {instrument} = require('../scripts/coverage-instrument.cjs');
// Instrument these source-only injected adapters exactly as the application inventory does.
async function adapters(options={}) {
  const result = await esbuild.build({entryPoints:['src/preview-session.ts','src/preview-preferences.ts','src/async.ts'],bundle:true,write:false,outdir:'out',platform:'node',format:'cjs',plugins:[{name:'source',setup(build){build.onLoad({filter:/\.ts$/},args=>({contents:instrument(args.path).code,loader:'ts'}));}}]});
  const exports = result.outputFiles.map(file=>{const module={exports:{}};vm.runInNewContext(file.text,{module,exports:module.exports,setTimeout,clearTimeout,console:{error:options.error ?? (()=>{})},__coverage__:globalThis.__coverage__ ??= {}});return module.exports;});
  return {...exports[0],...exports[1],...exports[2]};
}
const deferred = () => {let resolve,reject;const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('session guards parser/provider failures, stale results, timers and listener lifetime', async()=>{
  const {PreviewSession,PreviewNavigationAdapter,sessionDiagnostic} = await adapters();
  const lines=[]; const session=new PreviewSession(sessionDiagnostic({appendLine:line=>lines.push(line)}));
  assert.equal(session.boundary('parse Markdown',()=>{throw new Error('secret full Markdown');}),undefined);
  const adapter=new PreviewNavigationAdapter(session);
  assert.equal(await adapter.resolve('read file',()=>{throw new Error('secret path');}),undefined);
  assert.equal(await adapter.resolve('read file',()=>Promise.reject(new Error('secret credentials'))),undefined);
  assert.equal(await adapter.resolve('read file',()=>42),42);
  const pending=deferred();const request=adapter.resolve('read file',()=>pending.promise);session.supersede();pending.resolve(4);assert.equal(await request,undefined);
  const rejected=deferred();const stale=adapter.resolve('read file',()=>rejected.promise);session.supersede();rejected.reject(new Error('late'));assert.equal(await stale,undefined);
  let timers=0,released=0;session.own({dispose(){released++;}});session.own({dispose(){throw Error('secret release');}});session.debounce(()=>timers++,1);session.supersede();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(timers,0);
  session.debounce(()=>timers++,1);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(timers,1);
  session.debounce(()=>timers++,20);session.dispose();session.dispose();session.own({dispose(){released++;}});
  assert.equal(await session.run('disposed',()=>{throw new Error('must not run');}),undefined);assert.equal(session.boundary('disposed',()=>1),undefined);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(timers,1);assert.equal(released,2);
  assert.equal(lines.length,4);assert.ok(lines.every(line=>!line.includes('secret')));
});
test('bridge reports rejected and declined delivery and drops disposed/superseded completions',async()=>{
  const {PreviewSession,PreviewHostBridge}=await adapters();const diagnostics=[];const session=new PreviewSession(op=>diagnostics.push(op));
  assert.equal(await new PreviewHostBridge(session,()=>Promise.resolve(true)).post({}),true);
  assert.equal(await new PreviewHostBridge(session,()=>Promise.resolve(false)).post({}),false);
  assert.equal(await new PreviewHostBridge(session,()=>Promise.reject(Error('private'))).post({}),false);
  const pending=deferred();const send=new PreviewHostBridge(session,()=>pending.promise).post({});session.supersede();pending.resolve(true);assert.equal(await send,false);
  session.dispose();let posted=false;assert.equal(await new PreviewHostBridge(session,()=>{posted=true;return Promise.resolve(true);}).post({}),false);assert.equal(posted,false);assert.equal(diagnostics.length,2);
});
test('preference store serializes saves, retains failures and ignores late/disposed writes',async()=>{
  const {PreviewSession,PreviewPreferenceStore}=await adapters();const diagnostics=[];const session=new PreviewSession(op=>diagnostics.push(op));let config={style:'default'};const store=new PreviewPreferenceStore(session,()=>config,config);let changed=0,failed=0;
  assert.equal(store.effective().style,'default');
  await store.set('style','reading',async()=>{config={style:'reading'};},()=>changed++,()=>failed++);assert.equal(store.effective().style,'reading');
  await store.set('style','dark',()=>Promise.reject(Error('configuration secret')),()=>changed++,()=>failed++);assert.equal(store.effective().style,'dark');assert.equal(failed,1);
  const pending=deferred();const write=store.set('style','old',()=>pending.promise,()=>changed++,()=>failed++);await Promise.resolve();const queued=store.set('style','new',async()=>{config={style:'new'};},()=>changed++,()=>failed++);pending.resolve();await write;await queued;assert.equal(store.effective().style,'new');
  const disposed=deferred();const late=store.set('style','late',()=>disposed.promise,()=>changed++,()=>failed++);await Promise.resolve();session.dispose();disposed.resolve();await late;assert.equal(changed,4);await store.set('style','ignored',async()=>{throw Error('must not write');},()=>changed++,()=>failed++);
  const fallback=new PreviewPreferenceStore(new PreviewSession(op=>diagnostics.push(op)),()=>{throw Error('read secret');},{style:'safe'});assert.equal(fallback.effective().style,'safe');assert.equal(diagnostics.length,2);
});


test('diagnostic and disposer failures cannot escape any boundary',async()=>{
  const {PreviewSession}=await adapters();const session=new PreviewSession(()=>{throw Error('logger closed');});
  assert.equal(session.boundary('parse',()=>{throw Error('private');}),undefined);
  assert.equal(await session.run('read',()=>Promise.reject(Error('private'))),undefined);
  session.own({dispose(){throw Error('listener');}});session.dispose();session.own({dispose(){throw Error('late listener');}});
  let fired=false;session.debounce(()=>{fired=true;},1);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(fired,false);
});
test('navigation clears failed and pending preference overrides for the next document',async()=>{
  const {PreviewSession,PreviewPreferenceStore}=await adapters();const session=new PreviewSession(()=>{});let config={style:'old default'};const store=new PreviewPreferenceStore(session,()=>config,config);
  await store.set('style','failed override',()=>Promise.reject(Error('read-only')),()=>{},()=>{});assert.equal(store.effective().style,'failed override');
  const pending=deferred();const late=store.set('style','pending override',()=>pending.promise,()=>{throw Error('late notification');},()=>{});await Promise.resolve();
  const queued=store.set('style','queued override',async()=>{throw Error('must not write old settings');},()=>{},()=>{});session.supersede();config={style:'new default'};assert.equal(store.effective().style,'new default');pending.resolve();await late;await queued;assert.equal(store.effective().style,'new default');
});
test('bridge receives unknown input through an observed generation boundary',async()=>{
  const {PreviewSession,PreviewHostBridge}=await adapters();const operations=[];const session=new PreviewSession(op=>operations.push(op));const bridge=new PreviewHostBridge(session,()=>Promise.resolve(true));let received;
  await bridge.receive(null,(raw,generation)=>{received={raw,generation};});assert.equal(received.raw,null);assert.equal(received.generation,0);
  await bridge.receive('hostile input',()=>{throw Error('private message');});await bridge.receive({},()=>Promise.reject(Error('private operation')));assert.equal(operations.length,2);
  session.dispose();await bridge.receive({},()=>{throw Error('must not run');});assert.equal(operations.length,2);
});

test('detached operations report fixed diagnostics and absorb failing loggers',async()=>{
  const errors=[];const {reportAsync}=await adapters({error:(...values)=>errors.push(values)});let failed=0;
  reportAsync(Promise.resolve(4));reportAsync(Promise.reject(Error('private provider')));reportAsync(Promise.reject(Error('private token')),()=>failed++);reportAsync(Promise.reject(Error('private logger')),()=>{throw Error('logger closed');});
  await new Promise(setImmediate);assert.equal(failed,1);assert.equal(errors.length,1);assert.ok(!JSON.stringify(errors).includes('private'));
});
test('explicit failure reports remain silent after disposal',async()=>{
  const {PreviewSession}=await adapters();let logs=0;const session=new PreviewSession(()=>logs++);session.dispose();const generation=session.capture();session.supersede();assert.equal(session.capture(),generation);session.fail('late operation');assert.equal(logs,0);
});
