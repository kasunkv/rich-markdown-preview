const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function fixture(){
 const uri=value=>({scheme:'readonly',authority:'fixture',path:value,toString(){return 'readonly://fixture'+this.path;}});
 const root=uri('/work'),token={isCancellationRequested:false},reads=[];
 const tree=new Map([['/work',[['docs',2],['.hidden',2],['node_modules',2],['README.md',1],['README.markdown',1],['image.svg',1],['link.md',65],['.',2],['..',2],['bad/name.md',1],['',1],['bad\\name.md',1],['bad'+String.fromCharCode(0),1]]],['/work/docs',[['guide.MD',1],['ignored.md',1],['sub',2]]],['/work/docs/sub',[['report.MARKDOWN',1]]],['/work/.hidden',[['notes.md',1]]]]);
 const vscode={Uri:{joinPath:(base,...parts)=>uri(path.posix.join(base.path,...parts))},FileType:{File:1,Directory:2,SymbolicLink:64},workspace:{isTrusted:true,workspaceFolders:[{uri:root}],fs:{stat:async()=>({type:2}),readDirectory:async target=>{reads.push(target.path);if(!tree.has(target.path))throw Error('Must not traverse excluded folders');return tree.get(target.path);}}}};
 function load(name){const filename=path.resolve('src/'+name+'.ts');const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:name=>name==='vscode'?vscode:name==='./provider-paths'?load('provider-paths'):require(name),__coverage__:globalThis.__coverage__??={}});return m.exports;}
 const scanner=load('provider-discovery'),scan=scanner.discoverProviderMarkdown;
 const run=(include='**/*.{md,MD,markdown,MARKDOWN}',exclude='**/{node_modules,.git}/**',limits)=>scan(root,include,exclude,token,limits);
 const bounded=(maxResults,include='**/*.{md,MD,markdown,MARKDOWN}',exclude='**/{node_modules,.git}/**')=>scanner.discoverProviderMarkdownBounded(root,include,exclude,token,maxResults);
 return {run,bounded,root,uri,token,tree,reads,vscode};
}
test('provider discovery preserves URI identity and VS Code-style explicit glob/include/exclude semantics',async()=>{
 const h=fixture();const files=await h.run();assert.deepEqual(Array.from(files,value=>value.path).sort(),['/work/.hidden/notes.md','/work/README.markdown','/work/README.md','/work/docs/guide.MD','/work/docs/ignored.md','/work/docs/sub/report.MARKDOWN']);assert.ok(files.every(value=>value.scheme==='readonly'&&value.authority==='fixture'));assert.ok(!h.reads.some(value=>value.includes('node_modules')));
 const nested=fixture();assert.deepEqual(Array.from(await nested.run('docs/**/g?ide.[M][D]','**/{node_modules,ignored.md}/**'),value=>value.path),['/work/docs/guide.MD']);
 const direct=fixture();direct.tree.set('/work',[['#notes.md',1],['!literal.md',1]]);assert.deepEqual(Array.from(await direct.run('#*.md',''),value=>value.path),['/work/#notes.md']);assert.deepEqual(Array.from(await direct.run('!literal.md',''),value=>value.path),['/work/!literal.md']);
 const explicit=fixture();assert.ok(!(await explicit.run('**/*.md','**/{node_modules,ignored.md}/**')).some(value=>value.path.endsWith('ignored.md')));
});
test('provider discovery refuses restricted/canceled/removed roots and reported root symlinks before directory reads',async()=>{
 for(const state of ['restricted','canceled','removed','absent','symlink','file']){const h=fixture();if(state==='restricted')h.vscode.workspace.isTrusted=false;if(state==='canceled')h.token.isCancellationRequested=true;if(state==='removed')h.vscode.workspace.workspaceFolders=[];if(state==='absent')h.vscode.workspace.workspaceFolders=undefined;if(state==='symlink'||state==='file')h.vscode.workspace.fs.stat=async()=>({type:state==='symlink'?66:1});assert.deepEqual(Array.from(await h.run()),[]);assert.equal(h.reads.length,0);}
});
test('provider discovery rechecks trust, cancellation and root membership across asynchronous boundaries',async()=>{
 for(const phase of ['stat','directory','next','final']){const h=fixture();if(phase==='stat')h.vscode.workspace.fs.stat=async()=>{h.vscode.workspace.isTrusted=false;return {type:2};};if(phase==='directory')h.vscode.workspace.fs.readDirectory=async()=>{h.vscode.workspace.workspaceFolders=[];return [];};if(phase==='next')h.vscode.Uri.joinPath=(base,name)=>{h.token.isCancellationRequested=true;return h.uri(path.posix.join(base.path,name));};if(phase==='final'){h.tree.set('/work',[['one.md',1]]);h.vscode.Uri.joinPath=(base,name)=>{h.vscode.workspace.isTrusted=false;return h.uri(path.posix.join(base.path,name));};}assert.deepEqual(Array.from(await h.run()),[],phase);}
});
test('provider discovery enforces entry, result and depth caps and rejects escaped provider entries',async()=>{
 for(const [limit,message] of [[{entries:0,results:100,depth:10},'entry'],[{entries:100,results:0,depth:10},'result'],[{entries:100,results:100,depth:0},'depth']]){const h=fixture();if(message==='result')h.tree.set('/work',[['one.md',1]]);await assert.rejects(h.run(undefined,undefined,limit),new RegExp(message+' limit'));}
 const h=fixture();h.tree.set('/work',[['one.md',1]]);h.vscode.Uri.joinPath=()=>h.uri('/outside/one.md');assert.deepEqual(Array.from(await h.run()),[]);
});
test('bounded provider discovery reports partial results and stops after one excess match',async()=>{
 const h=fixture();h.tree.set('/work',Array.from({length:5002},(_,i)=>[`${i}.md`,1]));
 const limited=await h.bounded(3,'**/*.md','');
 assert.equal(limited.uris.length,3);assert.equal(limited.truncated,true);assert.equal(limited.complete,false);
 const providerCap=await h.bounded(10000,'**/*.md','');
 assert.equal(providerCap.uris.length,5000);assert.equal(providerCap.truncated,true);assert.equal(providerCap.complete,false);
 const complete=fixture();complete.tree.set('/work',[['one.md',1]]);
 const found=await complete.bounded(3,'**/*.md','');
 assert.deepEqual(Array.from(found.uris,value=>value.path),['/work/one.md']);
 assert.equal(found.truncated,false);assert.equal(found.complete,true);
});
test('bounded provider discovery treats trust loss and canceled traversal as incomplete',async()=>{
 const h=fixture();h.vscode.workspace.fs.readDirectory=async()=>{h.vscode.workspace.isTrusted=false;return [['one.md',1]];};
 const result=await h.bounded(3,'**/*.md','');
 assert.equal(result.complete,false);assert.equal(result.uris.length,0);
 const overflow=fixture();overflow.tree.set('/work',[['one.md',1],['two.md',1]]);
 const join=overflow.vscode.Uri.joinPath;let joins=0;
 overflow.vscode.Uri.joinPath=(base,name)=>{const target=join(base,name);if(++joins===2)overflow.vscode.workspace.isTrusted=false;return target;};
 const denied=await overflow.bounded(1,'**/*.md','');
 assert.equal(denied.complete,false);assert.equal(denied.uris.length,0);
});
