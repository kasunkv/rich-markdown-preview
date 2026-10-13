const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {host}=require('./documentation-host.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function providerHost(){
 const h=host({folders:['/repo']});
 const uri=value=>({scheme:'readonly',authority:'fixture',path:value,with(changes){return {...this,...changes};},toString(){return `readonly://fixture${this.path}`;}});
 h.vscode.Uri.joinPath=(base,...parts)=>base.scheme==='readonly'?uri(path.posix.join(base.path,...parts)):h.uri(path.posix.join(base.path,...parts));
 h.vscode.workspace.workspaceFolders[0].uri=uri('/repo');h.vscode.workspace.isTrusted=true;
 h.vscode.workspace.openTextDocument=async target=>h.getDocument(uri(target.path));
 h.vscode.FileType.SymbolicLink=64;
 h.vscode.workspace.fs.stat=async target=>({type:target.path.endsWith('.svg')?1:2});
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

