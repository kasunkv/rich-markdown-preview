const {test}=require('node:test');const assert=require('node:assert/strict');const {previewHost}=require('./preview-host.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('unchanged view events skip full render; hidden edits and stale provider work pause until reveal',async()=>{
 const h=previewHost();await h.handlers.command();await h.drain();const count=h.messages.filter(m=>m.type==='render').length;
 h.handlers.view();h.handlers.view();await h.drain();assert.equal(h.messages.filter(m=>m.type==='render').length,count);
 h.panel.visible=false;h.handlers.view();h.document.getText=()=> '# Hidden newest';h.document.version=2;h.handlers.text({document:h.document});await sleep(210);assert.equal(h.messages.filter(m=>m.type==='render').length,count);
 h.panel.visible=true;h.handlers.view();await h.drain();assert.match(h.messages.at(-1).html,/Hidden newest/);
 h.panel.dispose();const done=h.messages.length;h.resourceEvents.forEach(fn=>fn());h.handlers.view();await h.drain();assert.equal(h.messages.length,done);
});
test('resource policy epochs and workspace roots invalidate cached body on unchanged source',async()=>{
 const h=previewHost();await h.handlers.command();await h.drain();const count=h.messages.filter(m=>m.type==='render').length;
 h.resourceEvents[0]();await sleep(210);assert.equal(h.messages.filter(m=>m.type==='render').length,count+1);
 h.handlers.folders();h.handlers.view();await h.drain();assert.equal(h.messages.filter(m=>m.type==='render').length,count+2);
});
test('provider render queued before rapid source replacement cannot publish old body',async()=>{
 const h=previewHost({initializeVscode(vscode){vscode.window.activeTextEditor.document.uri.scheme='readonly';vscode.window.activeTextEditor.document.uri.authority='fixture';vscode.window.activeTextEditor.document.uri.path='/work/doc.md';vscode.Uri.joinPath=(base,...parts)=>{const value={...base,path:require('node:path').posix.join(base.path,...parts)};value.toString=()=>`readonly://fixture${value.path}`;return value;};vscode.window.activeTextEditor.document.uri.toString=()=> 'readonly://fixture/work/doc.md';vscode.workspace.getWorkspaceFolder=()=>({uri:{scheme:'readonly',authority:'fixture',path:'/work',toString:()=> 'readonly://fixture/work'}});}});
 h.document.getText=()=> '# Old\n![same](image.svg)';const releases=[];
 h.vscode.workspace.fs.stat=target=>new Promise(resolve=>releases.push(()=>resolve({type:target.path==='/work'?2:1})));
 await h.handlers.command();assert.equal(releases.length,1);
 h.document.getText=()=> '# New';h.document.version=3;h.handlers.text({document:h.document});releases.forEach(fn=>fn());await sleep(210);await h.drain();const renders=h.messages.filter(m=>m.type==='render');assert.equal(renders.length,1);assert.match(renders[0].html,/>New</);assert.doesNotMatch(renders[0].html,/Old/);
});

test('slow provider reads show a readable fallback, retry after settlement and remain owned by disposal',async()=>{
 const h=previewHost({initializeVscode(vscode){vscode.window.activeTextEditor.document.uri.scheme='readonly';vscode.window.activeTextEditor.document.uri.authority='fixture';vscode.window.activeTextEditor.document.uri.path='/work/doc.md';vscode.Uri.joinPath=(base,...parts)=>{const value={...base,path:require('node:path').posix.join(base.path,...parts)};value.toString=()=>`readonly://fixture${value.path}`;return value;};vscode.window.activeTextEditor.document.uri.toString=()=> 'readonly://fixture/work/doc.md';vscode.workspace.getWorkspaceFolder=()=>({uri:{scheme:'readonly',authority:'fixture',path:'/work',toString:()=> 'readonly://fixture/work'}});}});
 h.document.getText=()=> '# Readable\n![alt](image.svg)';let finish,slow=true;
 h.vscode.workspace.fs.stat=target=>slow?new Promise(resolve=>{finish=()=>{slow=false;resolve({type:2});};}):Promise.resolve({type:target.path==='/work'?2:1});
 await h.handlers.command();await sleep(2050);assert.match(h.messages.filter(m=>m.type==='render').at(-1).html,/still waiting for their provider/);assert.match(h.messages.filter(m=>m.type==='render').at(-1).html,/Readable/);
 finish();await sleep(220);await h.drain();assert.doesNotMatch(h.messages.filter(m=>m.type==='render').at(-1).html,/still waiting/);assert.match(h.messages.filter(m=>m.type==='render').at(-1).html,/https:\/\/safe-resource/);slow=true;h.document.getText=()=> ['# Disposed late read','![alt](late.svg)'].join(String.fromCharCode(10));h.document.version=4;h.handlers.text({document:h.document});await sleep(2250);const count=h.messages.length;h.panel.dispose();finish();await h.drain();assert.equal(h.messages.length,count);
});

test('provider data images bypass filesystem authorization while preserving the current model',async()=>{
 const h=previewHost({initializeVscode(vscode){vscode.window.activeTextEditor.document.uri.scheme='readonly';vscode.window.activeTextEditor.document.uri.toString=()=> 'readonly://fixture/work/doc.md';}});h.document.getText=()=> '# Inline\n![small](data:image/png;base64,eA==)';let reads=0;h.vscode.workspace.fs.stat=async()=>{reads++;throw Error('data images need no provider reads');};await h.handlers.command();await h.drain();assert.equal(reads,0);assert.match(h.messages.filter(m=>m.type==='render').at(-1).html,/src="data:image\/png;base64,eA=="/);
});
