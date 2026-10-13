const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const filename=path.resolve('src/async-images.ts');const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,__coverage__:globalThis.__coverage__??={}});
const {renderWithAsyncImages}=m.exports;
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
