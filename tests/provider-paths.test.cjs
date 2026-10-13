const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const filename=path.resolve('src/provider-paths.ts');
const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');
const moduleObject={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleObject,exports:moduleObject.exports,__coverage__:globalThis.__coverage__??={}});
const {resolveReference,sameProviderWithin}=moduleObject.exports;
const uri=(scheme,authority,value)=>({scheme,authority,path:value});
const adapter={joinPath:(base,...parts)=>({...base,path:path.posix.join(base.path,...parts)}),file:value=>uri('file','',value),platform:'win32',home:'C:/Users/test'};
const json=value=>JSON.parse(JSON.stringify(value));

test('relative and leading slash references preserve remote and custom provider identity',()=>{
 for(const scheme of ['file','vscode-remote','readonly']){
  const root=uri(scheme,'authority','/work');const directory=uri(scheme,'authority','/work/docs');
  for(const [ref,setting,expected] of [['../assets/a%20b.md','','/work/assets/a b.md'],['/README.md','','/work/README.md'],['/guide.md','package','/work/package/guide.md'],['guide.md','','/work/docs/guide.md']]){
   assert.deepEqual(json(resolveReference(ref,directory,root,setting,adapter)),{kind:'target',uri:uri(scheme,'authority',expected)});
  }
 }
});
test('host paths refuse provider conversion and unsupported Windows hosts with actionable results',()=>{
 const root=uri('readonly','repo','/work');
 for(const [ref,setting] of [['C:/private.md',''],['~/private.md',''],['/guide.md','C:/private']]){
  const result=resolveReference(ref,root,root,setting,{...adapter,file(){throw Error('provider must not convert');}});
  assert.equal(result.kind,'unsupported');assert.match(result.message,/relative path/);
 }
 const local=uri('file','','/work');
 for(const [ref,setting] of [['C:/private.md',''],['/guide.md','C:/private']])assert.equal(resolveReference(ref,local,local,setting,{...adapter,platform:'linux'}).kind,'unsupported');
 assert.equal(resolveReference('C:/guide.md',local,local,'',adapter).uri.path,'C:/guide.md');
 assert.equal(resolveReference('~/guide.md',local,local,'',adapter).uri.path,'C:/Users/test/guide.md');
 assert.equal(resolveReference('/guide.md',local,local,'C:/root',adapter).uri.path,'C:/root/guide.md');
});
test('invalid URI paths are explicit and provider containment rejects identity and prefix confusion',()=>{
 const root=uri('readonly','repo','/work');
 for(const ref of ['%ZZ','','a'.repeat(8193),'%00','%7F','//host/file','command:bad','file:///private'])assert.equal(resolveReference(ref,root,root,'',adapter).kind,'invalid');
 assert.equal(sameProviderWithin(root,uri('readonly','repo','/work/docs/a.md')),true);
 assert.equal(sameProviderWithin({...root,path:'/work/'},root),true);
 for(const target of [uri('file','repo','/work/a.md'),uri('readonly','other','/work/a.md'),uri('readonly','repo','/work-other/a.md'),uri('readonly','repo','/outside/a.md')])assert.equal(sameProviderWithin(root,target),false);
});
