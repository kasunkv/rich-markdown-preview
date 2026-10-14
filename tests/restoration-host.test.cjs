const {test}=require('node:test');
const assert=require('node:assert/strict');
const {host}=require('./documentation-host.cjs');
const state=(kind='preview',target='file:///repo/README.md')=>({readingStateVersion:1,documents:{},documentOrder:[],documentId:target,session:{version:1,kind,target,workspaceRoot:'file:///repo',history:target?[target]:[],cursor:target?0:-1}});
const fallback=home=>{assert.match(home.latest('render').html,/role="status"/);assert.match(home.latest('render').html,/Preview could not be restored/);assert.equal(home.latest('render').session,undefined);};
test('serializers restore into supplied panels through the existing controller and context contract',async()=>{
 for(const kind of ['preview','documentation']){
  const home=host();const panel=await home.restore(kind,state(kind));assert.equal(home.panels.length,1);assert.equal(panel.type,kind==='preview'?'richMarkdownPreview.preview':'richMarkdownPreview.documentationHome');assert.equal(home.latest('render').documentId,'file:///repo/README.md');assert.equal(home.reads.length,1);assert.equal(home.latest('render').session.kind,kind);assert.ok(panel.webview.options.localResourceRoots.length>=2);panel.dispose();
 }
 const home=host();await home.restore('documentation',{readingStateVersion:1,documents:{},documentOrder:[],session:{version:1,kind:'documentation',history:[],cursor:-1}});assert.equal(home.reads.length,0);assert.equal(home.latest('render').documentId,'home');
 const manifest=require('../package.json');for(const type of Object.keys(home.serializers))assert.ok(manifest.activationEvents.includes('onWebviewPanel:'+type));
});
test('obsolete, forged, removed-root, outside, provider-unavailable and missing targets recover without forbidden reads',async()=>{
 const cases=[undefined,{}, {...state(),readingStateVersion:2}, {...state(),session:{...state().session,version:2}}, {...state(),session:{...state().session,privacyGrants:['https://example.com']}}, state('documentation'), state('preview','command:evil'), state('preview','https://example.com/a.md'),state('preview','file:///outside/a.md'),state('preview','file:///repo/../outside/a.md'),state('preview','file:///repo/README.md?x'),state('preview','file:///repo/README.md#x'), {...state(),session:{...state().session,workspaceRoot:'file:///removed'}},state('preview','missing-provider://fixture/read.md'),state('preview','file:///repo/deleted.md')];
 for(const value of cases){const home=host();await home.restore('preview',value);fallback(home);assert.equal(home.reads.length,0);}
 const removed=host({folders:[]});await removed.restore('preview',state());fallback(removed);assert.equal(removed.reads.length,0);
 const denied=host({trusted:false});denied.vscode.workspace.getWorkspaceFolder=()=>undefined;await denied.restore('preview',state());fallback(denied);assert.equal(denied.reads.length,0);
 const failed=host();failed.vscode.workspace.openTextDocument=async()=>{throw Error('private provider failure');};await failed.restore('preview',state());fallback(failed);assert.ok(!failed.latest('render').html.includes('private provider'));
});
test('provider stat and open races cannot read after root removal or publish disallowed content',async()=>{
 const root=host();root.vscode.workspace.fs.stat=async()=>{root.vscode.workspace.workspaceFolders=[];return {type:1};};await root.restore('preview',state());fallback(root);assert.equal(root.reads.length,0);
 const opening=host();const original=opening.vscode.workspace.openTextDocument;opening.vscode.workspace.openTextDocument=async target=>{const doc=await original(target);opening.vscode.workspace.workspaceFolders=[];return doc;};await opening.restore('preview',state());fallback(opening);assert.ok(!opening.latest('render').html.includes('Welcome'));
});
test('restored Home Back/Forward validates each saved entry before lookup and preserves useful context',async()=>{
 const home=host();const saved=state('documentation','file:///repo/docs/guide.md');saved.session.history=['file:///repo/README.md',saved.session.target,'file:///repo/reports/2026/october/summary.MD'];saved.session.cursor=1;
 await home.restore('documentation',saved);assert.equal(home.latest('documentation').canBack,true);assert.equal(home.latest('documentation').canForward,true);
 await home.action('back');assert.equal(home.latest('render').documentId,'file:///repo/README.md');await home.action('forward');assert.equal(home.latest('render').documentId,'file:///repo/docs/guide.md');home.files.delete('/repo/reports/2026/october/summary.MD');const reads=home.reads.length;await home.action('forward');assert.equal(home.reads.length,reads);assert.match(home.warnings.at(-1),/saved document is unavailable/);
});
test('file URI spelling does not substitute case-sensitive provider containment for canonical filesystem policy',async()=>{
 const home=host();const canonicalRoot=home.uri('/repo');canonicalRoot.path='/REPO';home.vscode.workspace.getWorkspaceFolder=()=>({uri:canonicalRoot});await home.restore('preview',state());assert.equal(home.latest('render').documentId,'file:///repo/README.md');
});
test('read-only opaque providers restore with URI identity, reject unavailable providers and suspend in Restricted Mode',async()=>{
 for(const mode of ['readonly','unavailable','restricted','authority-change','root-change','trust-race']){
  const home=host({trusted:mode!=='restricted'});const stats=[];const reads=[];
  const uri=value=>{const parsed=new URL(value);return {scheme:parsed.protocol.slice(0,-1),authority:parsed.host,path:parsed.pathname,query:parsed.search.slice(1),fragment:parsed.hash.slice(1),toString:()=>value,get fsPath(){throw Error('opaque URI has no host filesystem path');}};};
  const target='rmp-readonly://fixture/repo/read.md';const root=uri('rmp-readonly://fixture/repo');
  home.vscode.Uri.parse=uri;home.vscode.Uri.joinPath=(base,...parts)=>base.scheme==='rmp-readonly'?uri(base.toString()+'/'+parts.join('/')):home.uri(base.path+'/'+parts.join('/'));
  home.vscode.workspace.workspaceFolders=[{uri:root,name:'Provider'}];home.vscode.workspace.getWorkspaceFolder=()=>({uri:mode==='authority-change'?uri('rmp-readonly://other/repo'):root});
  home.vscode.workspace.fs.isWritableFileSystem=()=>mode==='unavailable'?undefined:false;
  home.vscode.workspace.fs.stat=async value=>{stats.push(value.toString());if(mode==='root-change')home.vscode.workspace.getWorkspaceFolder=()=>undefined;if(mode==='trust-race')home.vscode.workspace.isTrusted=false;return {type:1};};
  home.vscode.workspace.openTextDocument=async value=>{reads.push(value.toString());return {uri:value,fileName:'read.md',languageId:'markdown',getText:()=> '# Provider restored'};};
  const saved=state('preview',target);saved.session.workspaceRoot=root.toString();await home.restore('preview',saved);await new Promise(setImmediate);
  if(mode==='readonly'){assert.deepEqual(reads,[target]);assert.equal(home.latest('render').documentId,target);assert.equal(stats.length,1);}else{fallback(home);assert.equal(reads.length,0);if(['unavailable','restricted','authority-change'].includes(mode))assert.equal(stats.length,0);}
 }
});
test('closing a panel during stat or document open cannot attach or publish a restored controller',async()=>{
 for(const phase of ['stat','open']){
  const home=host();const read=home.vscode.workspace.openTextDocument;
  if(phase==='stat')home.vscode.workspace.fs.stat=async()=>{home.panels[0].dispose();return {type:1};};
  else home.vscode.workspace.openTextDocument=async target=>{const document=await read(target);home.panels[0].dispose();return document;};
  await home.restore('preview',state());assert.equal(home.messages.length,0);if(phase==='stat')assert.equal(home.reads.length,0);
 }
});
