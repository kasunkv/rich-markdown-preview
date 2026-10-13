const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {host}=require('./documentation-host.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function providerHost(scheme='readonly',authority='fixture'){
 const h=host({folders:['/repo']});
 const uri=value=>({scheme,authority,path:value,with(changes){return {...this,...changes};},toString(){return `${scheme}://${authority}${this.path}`;}});
 h.vscode.Uri.joinPath=(base,...parts)=>base.scheme===scheme?uri(path.posix.join(base.path,...parts)):h.uri(path.posix.join(base.path,...parts));
 h.vscode.workspace.workspaceFolders[0].uri=uri('/repo');h.vscode.workspace.isTrusted=true;
 h.vscode.workspace.openTextDocument=async target=>h.getDocument(uri(target.path));
 h.vscode.FileType.SymbolicLink=64;
 h.vscode.workspace.fs.stat=async target=>({type:/\.(svg|md|markdown)$/i.test(target.path)?1:2});
 h.files.set('/repo/README.md','# Provider\n\n![Provider](assets/test.svg)\n\n{{include: ~/private.md}}');
 return h;
}
test('provider host integration posts authorized image URIs and refuses export and home mappings',async()=>{
 const h=providerHost();await h.openSingle();await new Promise(setImmediate);const render=h.latest('render');assert.match(render.html,/readonly:\/\/fixture\/repo\/assets\/test.svg/);assert.equal(render.documentId,'readonly://fixture/repo/README.md');
 await h.panels[0].message({type:'reference',id:'reference-0'});assert.match(h.warnings.at(-1),/Host absolute and home paths are unavailable/);assert.equal(h.opened.length,0);
 await h.panels[0].message({type:'tableExport',text:'"fixture"\r\n'});assert.match(h.warnings.at(-1),/CSV export is unavailable/);assert.equal(h.latest('tableActionResult').success,false);h.panels[0].dispose();
});
test('provider image completion cannot post after disposal, source edits',async()=>{
 for(const state of ['disposed','edited']){
  const h=providerHost(),pending=deferred();h.vscode.workspace.fs.stat=()=>pending.promise;await h.openSingle();const panel=h.panels[0],count=h.messages.length;
  if(state==='disposed')panel.dispose();else h.files.set('/repo/README.md','# Edited');
  pending.resolve({type:2});await new Promise(setImmediate);assert.equal(h.messages.filter(value=>value.type==='render').length,0,state);assert.equal(h.warnings.length,0,state);if(state!=='disposed')panel.dispose();
 }
});


test('remote-style provider fixtures preserve scheme and authority through image resolution and source references',async()=>{
 const h=providerHost('vscode-remote','ssh-remote+fixture');h.files.set('/repo/README.md','# Remote fixture\n\n![Remote](assets/test.svg)\n\n[Target](docs/guide.md#details)');await h.openSingle();await new Promise(setImmediate);const render=h.latest('render');assert.equal(render.documentId,'vscode-remote://ssh-remote+fixture/repo/README.md');assert.match(render.html,/vscode-remote:\/\/ssh-remote\+fixture\/repo\/assets\/test.svg/);
 const targets=[];const open=h.vscode.workspace.openTextDocument;h.vscode.workspace.openTextDocument=async uri=>{targets.push(uri);return open(uri);};await h.panels[0].message({type:'reference',id:'reference-0'});assert.equal(targets.at(-1).scheme,'vscode-remote');assert.equal(targets.at(-1).authority,'ssh-remote+fixture');assert.equal(h.selections.at(-1).start.line,2);h.panels[0].dispose();
});
