const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const filename=path.resolve('src/async-images.ts');const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,setTimeout,clearTimeout,require:name=>{if(name!=='./render-limits')throw Error('Unexpected import');const file=path.resolve('src/render-limits.ts'),text=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(file).code:fs.readFileSync(file,'utf8');const module={exports:{}};vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,__coverage__:globalThis.__coverage__??={}});return module.exports;},__coverage__:globalThis.__coverage__??={}});
const {renderWithAsyncImages,ProviderImageReadBudget}=m.exports;
test('provider image slots resolve once per source, escape attributes, and keep render metadata',async()=>{let calls=0;const result=await renderWithAsyncImages(image=>({html:`<img src="${image('same.svg')}"><img src="${image('same.svg')}"><img src="${image('missing.svg')}">`,outline:['heading']}),async src=>{calls++;return src==='same.svg'?'https://safe/?a=1&b="<unsafe>':'';});assert.equal(calls,2);assert.equal(result.html,'<img src="https://safe/?a=1&amp;b=&quot;&lt;unsafe&gt;"><img src="https://safe/?a=1&amp;b=&quot;&lt;unsafe&gt;"><img src="">');assert.deepEqual(result.outline,['heading']);});
test('failed provider resolution rejects the render and empty documents need no provider reads',async()=>{await assert.rejects(renderWithAsyncImages(image=>({html:`<img src="${image('bad.svg')}">`}),async()=>{throw Error('provider unavailable');}),/provider unavailable/);const result=await renderWithAsyncImages(()=>({html:'plain text'}),()=>{throw Error('must not read');});assert.equal(result.html,'plain text');const invalid=await renderWithAsyncImages(()=>({html:'<img src="rmp-provider-image-5">'}),async()=> '');assert.equal(invalid.html,'<img src="">');});
test('discarded fallback and unretained provider slots never start provider authorization',async()=>{
 const reads=[];
 const result=await renderWithAsyncImages(image=>{image('discarded.svg');return {html:'<p role="alert">Render rejected</p>',outline:[],references:[]};},async source=>{reads.push(source);throw Error('must not authorize discarded source');});
 assert.deepEqual(reads,[]);assert.deepEqual(result.references,[]);
 const partial=await renderWithAsyncImages(image=>{image('discarded.svg');return {html:`<img src="${image('retained.svg')}">`};},async source=>{reads.push(source);return 'safe';});
 assert.deepEqual(reads,['retained.svg']);assert.equal(partial.html,'<img src="safe">');
});
test('actual renderer fallback discards provider images and remote origin affordances together',async()=>{
 const {renderMarkdown}=require('../dist/render.cjs');const reads=[];
 const result=await renderWithAsyncImages(image=>renderMarkdown('![discarded](local.svg)\n![remote](https://images.example/image.svg)\n'+'### x\n'.repeat(100001),image),async source=>{reads.push(source);throw Error('rejected model must not authorize images');});
 assert.deepEqual(reads,[]);assert.deepEqual(result.outline,[]);assert.deepEqual(result.references,[]);assert.deepEqual(result.externalImageOrigins,[]);assert.match(result.html,/rendered content.*supported/);
});

test('provider work is deduplicated, bounded to four readers and capped at 128 sources',async()=>{
 let active=0,peak=0,calls=0;
 const result=await renderWithAsyncImages(image=>({html:Array.from({length:140},(_,i)=>`<img src="${image('image-'+i)}"><img src="${image('image-'+i)}">`).join('')}),async src=>{calls++;active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;return 'safe/'+src;});
 assert.equal(peak,4);assert.equal(calls,128);assert.match(result.html,/first 128 distinct local images/);assert.equal((result.html.match(/src=""/g)||[]).length,24);
});
test('superseded image work stops scheduling after bounded in-flight reads settle',async()=>{
 let current=true,calls=0;const releases=[];
 const pending=renderWithAsyncImages(image=>({html:Array.from({length:20},(_,i)=>`<img src="${image('image-'+i)}">`).join('')}),src=>{calls++;return new Promise(resolve=>releases.push(()=>resolve('safe/'+src)));},()=>current);
 assert.equal(calls,4);current=false;releases.forEach(fn=>fn());const result=await pending;assert.equal(calls,4);assert.doesNotMatch(result.html,/safe\//);
 const skipped=await renderWithAsyncImages(image=>({html:`<img src="${image('no')}">`}),()=>{throw Error('hidden read');},()=>false);assert.equal(skipped.html,'<img src="">');
});

test('provider failure stops the other bounded readers before they schedule more work',async()=>{
 let calls=0;const release=[];const pending=renderWithAsyncImages(image=>({html:Array.from({length:12},(_,i)=>`<img src="${image('image-'+i)}">`).join('')}),src=>{calls++;return src==='image-0'?Promise.reject(Error('failed')):new Promise(resolve=>release.push(()=>resolve('safe')));});await assert.rejects(pending,/failed/);release.forEach(fn=>fn());await new Promise(setImmediate);assert.equal(calls,4);
});

test('physical provider work stays bounded across render revisions and timed-out reads retain slots',async()=>{
 let available=0,calls=0;const budget=new ProviderImageReadBudget(()=>available++);const releases=[];
 const pending=Array.from({length:4},()=>budget.resolve(()=>{calls++;return new Promise(resolve=>releases.push(()=>resolve('safe')));},()=>true));
 await new Promise(setImmediate);assert.equal(calls,4);
 const busy=await budget.resolve(()=>{throw Error('fifth physical read');},()=>true);assert.equal(busy.busy,true);
 const stale=await budget.resolve(()=>{throw Error('stale read');},()=>false);assert.equal(stale.busy,false);
 const timed=await Promise.all(pending);assert.ok(timed.every(result=>result.busy));
 assert.equal((await budget.resolve(()=>{throw Error('timeout cannot free physical slot');},()=>true)).busy,true);
 releases.forEach(fn=>fn());await new Promise(setImmediate);assert.equal(available,1);
 assert.equal((await budget.resolve(async()=> 'next',()=>true)).resource,'next');
 await assert.rejects(budget.resolve(async()=>{throw Error('provider failed');},()=>true),/provider failed/);
});
