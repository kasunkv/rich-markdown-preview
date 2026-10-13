const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function uri(value){const url=new URL(value);return {scheme:url.protocol.slice(0,-1),authority:url.host,path:decodeURIComponent(url.pathname),toString(){return `${this.scheme}://${this.authority}${this.path}`;}};}
const joinPath=(base,...parts)=>({...base,path:path.posix.join(base.path,...parts)});
function fixture(){
 const root=uri('readonly://repo/work'),document=uri('readonly://repo/work/docs/guide.md');const files=new Map([['/work',2],['/work/docs',2],['/work/assets',2],['/work/assets/a #.svg',1],['/work/docs/inline.svg',1]]);const reads=[],converted=[];
 const vscode={Uri:{joinPath},FileType:{File:1,Directory:2,SymbolicLink:64},workspace:{isTrusted:true,fs:{stat:async target=>{reads.push(target);const type=files.get(target.path);if(type===undefined)throw Error('missing');return {type};}}}};
 const coverage=globalThis.__coverage__??={};
 function load(name){const filename=path.resolve(`src/${name}.ts`);const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:name=>name==='vscode'?vscode:name==='./resources'?{documentResourceRoot:()=>root,parseResourceUrl:load('resource-url').parseResourceUrl}:load(name.slice(2)),__coverage__:coverage});return m.exports;}
 const resolve=load('provider-images').resolveProviderImageResource;const webview={asWebviewUri:target=>{converted.push(target);return {toString:()=>`https://resource.invalid/${target.authority}${target.path}`};}};
 return {resolve,document,root,files,reads,converted,vscode,webview};
}
test('trusted provider images preserve URI identity and decoded filenames with URL suffixes',async()=>{const h=fixture();assert.equal(await h.resolve('../assets/a%20%23.svg?v=2#view',h.document,h.webview),'https://resource.invalid/repo/work/assets/a #.svg?v=2#view');assert.equal(h.converted[0].scheme,'readonly');assert.equal(h.converted[0].authority,'repo');assert.deepEqual(h.reads.map(value=>value.path),['/work','/work/assets','/work/assets/a #.svg']);assert.ok(await h.resolve('inline.svg',h.document,h.webview));});
test('missing, escaped, malformed, non-file and symlink provider images fail closed',async()=>{
 for(const value of ['', '%ZZ', '%00','%7f','dir\\file.svg','command:bad','file:///private.svg','readonly://other/work/image.svg','/private.svg','~/private.svg','../../secret.svg','missing.svg','../assets']){const h=fixture();assert.equal(await h.resolve(value,h.document,h.webview),'',value);assert.equal(h.converted.length,0);}
 for(const [target,type] of [['/work',66],['/work',1],['/work/assets',66],['/work/assets',1],['/work/assets/a #.svg',65],['/work/assets/a #.svg',0]]){const h=fixture();h.files.set(target,type);assert.equal(await h.resolve('../assets/a%20%23.svg',h.document,h.webview),'');assert.equal(h.converted.length,0);}
 const h=fixture();assert.equal(await h.resolve('.',h.document,h.webview),'');assert.equal(await h.resolve('..',h.document,h.webview),'');
});
test('Restricted Mode, file documents and trust changes cannot authorize provider image reads',async()=>{
 const h=fixture();h.vscode.workspace.isTrusted=false;assert.equal(await h.resolve('inline.svg',h.document,h.webview),'');assert.equal(h.reads.length,0);
 h.vscode.workspace.isTrusted=true;assert.equal(await h.resolve('inline.svg',uri('file:///work/docs/guide.md'),h.webview),'');assert.equal(h.reads.length,0);
 const stat=h.vscode.workspace.fs.stat;h.vscode.workspace.fs.stat=async target=>{const result=await stat(target);h.vscode.workspace.isTrusted=false;return result;};assert.equal(await h.resolve('inline.svg',h.document,h.webview),'');assert.equal(h.converted.length,0);
});

