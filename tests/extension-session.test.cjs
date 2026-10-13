const {test} = require('node:test');
const assert = require('node:assert/strict');
const {previewHost} = require('./preview-host.cjs');
const deferred = () => {let resolve,reject;const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('clipboard completion cannot notify a disposed session',async()=>{
  const host=previewHost();await host.handlers.command();const pending=deferred();host.vscode.env.clipboard.writeText=()=>pending.promise;
  const request=host.handlers.message({type:'copy',text:'private clipboard'});const count=host.messages.length;host.handlers.dispose();pending.resolve();await request;await host.drain();assert.equal(host.messages.length,count);assert.equal(host.counts().disposed,5);
});
test('export dialog cancellation and selection after disposal cannot write or post',async()=>{
  for(const destination of [undefined,{path:'/private/result.csv',toString:()=> 'file:///private/result.csv'}]){
    const host=previewHost();await host.handlers.command();const pending=deferred();host.vscode.window.showSaveDialog=()=>pending.promise;
    const request=host.handlers.message({type:'tableExport',text:'private CSV'});const count=host.messages.length;host.handlers.dispose();pending.resolve(destination);await request;assert.equal(host.files.length,0);assert.equal(host.messages.length,count);
  }
});
test('late failed filesystem export cannot warn or post after disposal',async()=>{
  const host=previewHost();await host.handlers.command();const pending=deferred();host.vscode.workspace.fs.writeFile=()=>pending.promise;
  const request=host.handlers.message({type:'tableExport',text:'private CSV'});await host.drain();const count=host.messages.length;host.handlers.dispose();pending.reject(Error('secret provider token'));await request;assert.equal(host.messages.length,count);assert.equal(host.warnings.length,0);assert.ok(!host.diagnostics.join('\n').includes('secret'));
});
test('preference writes and configuration reads have redacted failure boundaries',async()=>{
  const host=previewHost();await host.handlers.command();const pending=deferred();host.configuration.update=()=>pending.promise;
  await host.handlers.message({type:'preference',key:'style',value:'reading'});await host.drain();const count=host.messages.length;host.handlers.dispose();pending.reject(Error('secret config value'));await host.drain();assert.equal(host.messages.length,count);assert.equal(host.warnings.length,0);
  const reader=previewHost();await reader.handlers.command();reader.configuration.inspect=()=>{throw Error('secret configuration');};await reader.handlers.message({type:'ready'});assert.equal(reader.messages.at(-1).preferences.style,'documentation');assert.ok(reader.diagnostics.some(line=>line.includes('read preview configuration')));assert.ok(!reader.diagnostics.join('\n').includes('secret'));
});
test('pending reference stat is dropped after disposal and after document revision',async()=>{
  for(const dispose of [false,true]){
    const host=previewHost();host.document.getText=()=> '{{include: private.md}}';await host.handlers.command();await host.handlers.message({type:'ready'});const pending=deferred();host.vscode.workspace.fs.stat=()=>pending.promise;
    const request=host.handlers.message({type:'reference',id:'reference-0'});
    if(dispose)host.handlers.dispose();else {host.document.getText=()=> '# New revision';host.handlers.text({document:host.document});}
    pending.resolve({type:1});await request;assert.equal(host.opened.length,0);assert.equal(host.warnings.length,0);host.handlers.dispose();
  }
});
test('parser failures from view and debounced text refresh preserve the last render',async()=>{
  const host=previewHost();await host.handlers.command();await host.handlers.message({type:'ready'});const count=host.messages.length;host.document.getText=()=>{throw Error('private Markdown');};host.handlers.view();host.handlers.text({document:host.document});await new Promise(resolve=>setTimeout(resolve,220));assert.equal(host.messages.length,count);assert.ok(host.diagnostics.filter(line=>line.includes('render Markdown')).length>=2);assert.ok(!host.diagnostics.join('\n').includes('private'));
});
test('late clipboard and external-link errors cannot notify a disposed session',async()=>{
  for(const type of ['copy','tableCopy','link','reference']){
    const host=previewHost();host.document.getText=()=> '{{include: https://example.com/private.md}}';await host.handlers.command();await host.handlers.message({type:'ready'});const pending=deferred();host.vscode.env.clipboard.writeText=()=>pending.promise;host.vscode.env.openExternal=()=>pending.promise;
    const request=host.handlers.message(type==='reference'?{type,id:'reference-0'}:type==='link'?{type,href:'https://example.com/private'}:{type,text:'private contents'});const count=host.messages.length;host.handlers.dispose();pending.reject(Error('secret credentials'));await request;assert.equal(host.messages.length,count);assert.equal(host.warnings.length,0);assert.ok(!host.diagnostics.join('\n').includes('secret'));
  }
});
test('failed external providers report redacted operation diagnostics and useful warnings',async()=>{
  const host=previewHost();host.document.getText=()=> '{{include: https://example.com/private.md}}';await host.handlers.command();await host.handlers.message({type:'ready'});host.vscode.env.openExternal=()=>Promise.reject(Error('secret credentials'));
  await host.handlers.message({type:'reference',id:'reference-0'});await host.handlers.message({type:'link',href:'https://example.com/private'});assert.equal(host.warnings.length,2);assert.ok(host.diagnostics.some(line=>line.includes('open external reference')));assert.ok(host.diagnostics.some(line=>line.includes('open link')));assert.ok(!host.diagnostics.join('\n').includes('secret'));
});
test('failed preference overrides survive editing the same document',async()=>{
  const host=previewHost({failWrites:true});await host.handlers.command();await host.handlers.message({type:'preference',key:'style',value:'reading'});await host.drain();host.document.getText=()=> '# Edited';host.handlers.text({document:host.document});await new Promise(resolve=>setTimeout(resolve,220));assert.equal(host.messages.at(-1).preferences.style,'reading');host.handlers.dispose();
});

const {host:documentationHost} = require('./documentation-host.cjs');
test('source loading and source reveal reject disposed or superseded results',async()=>{
  for(const stage of ['load','reveal'])for(const dispose of [false,true]){
    const h=documentationHost();await h.openSingle();const pending=deferred();
    const target=h.uri('/repo/docs/guide.md');
    if(stage==='load')h.vscode.workspace.openTextDocument=()=>pending.promise;
    else h.vscode.window.showTextDocument=()=>pending.promise;
    const request=h.panels[0].message({type:'link',href:'docs/guide.md#details'});await new Promise(setImmediate);
    if(dispose)h.panels[0].dispose();else await h.panels[0].message({type:'link',href:'#welcome'});
    const count=h.messages.length;let revealed=false;pending.resolve(stage==='load'?h.getDocument(target):{revealRange(){revealed=true;}});await request;
    assert.equal(revealed,false);assert.equal(h.opened.length,0);assert.equal(h.messages.length,count);h.panels[0].dispose();
  }
});
test('source parser and provider failures have explicit safe outcomes',async()=>{
  const h=documentationHost();await h.openSingle();h.vscode.workspace.openTextDocument=async()=>{throw Error('credential source');};await h.panels[0].message({type:'link',href:'docs/guide.md#details'});assert.match(h.warnings.at(-1),/Check the target file access/);
  h.vscode.workspace.openTextDocument=async()=>({...h.getDocument(h.uri('/repo/docs/guide.md')),getText(){throw Error('private Markdown');}});await h.panels[0].message({type:'link',href:'docs/guide.md#details'});assert.equal(h.opened.at(-1),'/repo/docs/guide.md');assert.match(h.warnings.at(-1),/Could not locate/);
  h.vscode.window.showTextDocument=async()=>{throw Error('private editor error');};await h.panels[0].message({type:'link',href:'docs/guide.md#missing'});assert.match(h.warnings.at(-1),/Check the target file access/);
});
test('detached VS Code warning errors reach scoped redacted diagnostics',async()=>{
  const host=previewHost({missingReference:true});host.document.getText=()=> '{{include: missing.md}}';await host.handlers.command();await host.handlers.message({type:'ready'});host.vscode.window.showWarningMessage=()=>Promise.reject(Error('private dialog error'));await host.handlers.message({type:'reference',id:'reference-0'});await host.drain();assert.ok(host.diagnostics.some(line=>line.includes('host operation')));assert.ok(!host.diagnostics.join('\n').includes('private'));
});

test('pending initial document opens cannot create a preview after extension shutdown',async()=>{
  for(const fail of [false,true]){
    const host=previewHost();const pending=deferred();host.vscode.workspace.openTextDocument=()=>pending.promise;const opening=host.handlers.command(host.document.uri);host.subscriptions.find(item=>typeof item.capture==='function').dispose();
    if(fail)pending.reject(Error('private file access'));else pending.resolve(host.document);await opening;assert.equal(host.counts().created,0);assert.equal(host.warnings.length,0);
  }
});

test('successful late clipboard, export and external operations cannot post after disposal',async()=>{
  for(const type of ['tableCopy','tableExport','link','reference']){
    const host=previewHost();host.document.getText=()=> '{{include: https://example.com/private.md}}';await host.handlers.command();await host.handlers.message({type:'ready'});const pending=deferred();host.vscode.env.clipboard.writeText=()=>pending.promise;host.vscode.workspace.fs.writeFile=()=>pending.promise;host.vscode.env.openExternal=()=>pending.promise;
    const request=host.handlers.message(type==='reference'?{type,id:'reference-0'}:type==='link'?{type,href:'https://example.com/private'}:{type,text:'private contents'});await host.drain();const count=host.messages.length;host.handlers.dispose();pending.resolve();await request;assert.equal(host.messages.length,count);assert.equal(host.warnings.length,0);
  }
});
test('late source fallback, command and rejected editor operations have no follow-up effects',async()=>{
  for(const stage of ['fallback','command','rejected']){
    const h=documentationHost();await h.openSingle();const pending=deferred();
    if(stage==='command')h.vscode.commands.executeCommand=()=>pending.promise;else h.vscode.window.showTextDocument=()=>pending.promise;
    const request=h.panels[0].message({type:'link',href:stage==='command'?'src/app.ts':stage==='fallback'?'docs/guide.md#missing':'docs/guide.md#details'});await new Promise(setImmediate);const count=h.messages.length,warnings=h.warnings.length;h.panels[0].dispose();if(stage==='rejected')pending.reject(Error('private editor'));else pending.resolve({revealRange(){throw Error('must not reveal');}});await request;assert.equal(h.messages.length,count);assert.equal(h.warnings.length,warnings);
  }
});
test('same-file and Home source parser failures retain the visible document',async()=>{
  const single=documentationHost();await single.openSingle();single.files.get=()=>{throw Error('private source text');};const count=single.messages.length;await single.panels[0].message({type:'link',href:'#welcome'});assert.equal(single.messages.length,count);
  const home=documentationHost();await home.open();await home.action('open','/repo/README.md');home.vscode.workspace.openTextDocument=async()=>({...home.getDocument(home.uri('/repo/docs/guide.md')),getText(){throw Error('private source text');}});await home.panels[0].message({type:'link',href:'docs/guide.md#details'});assert.equal(home.latest('render').documentId,'file:///repo/README.md');
});
test('navigation configuration errors are bounded and stale errors do not warn',async()=>{
  for(const dispose of [false,true]){
    const h=documentationHost();await h.open();await h.action('open','/repo/README.md');const panel=h.panels[0];Object.defineProperty(panel.webview,'options',{get:()=>({}),set(){if(dispose)panel.dispose();throw Error('private resource options');}});const warningCount=h.warnings.length;await h.action('open','/repo/docs/guide.md');if(dispose)assert.equal(h.warnings.length,warningCount);else assert.match(h.warnings.at(-1),/Could not open this document/);
  }
});
test('reference candidate policy survives malformed, rooted, directory and home paths',async()=>{
  const h=documentationHost();h.files.set('/repo/README.md','{{include: %ZZ.md}}\n\n{{include: command:bad}}\n\n{{include: ~/guide.md}}\n\n{{include: C:/guide.md}}\n\n{{include: folder.md}}');await h.openSingle();const refs=h.latest('render').references;h.vscode.workspace.fs.stat=async target=>({type:target.path.endsWith('folder.md')?2:1});for(const ref of refs)await h.panels[0].message({type:'reference',id:ref.id});assert.ok(h.warnings.length>=2);assert.ok(h.opened.some(path=>path.endsWith('guide.md')));h.panels[0].dispose();
});
test('navigation drops pending clipboard, save-dialog and preference results',async()=>{
  for(const operation of ['copy','tableExport','preference']){
    const h=documentationHost();await h.open();await h.action('open','/repo/README.md');const pending=deferred();const writes=[];h.vscode.env={clipboard:{writeText:()=>pending.promise}};h.vscode.window.showSaveDialog=()=>pending.promise;h.vscode.workspace.fs.writeFile=async(...args)=>writes.push(args);
    const config=h.vscode.workspace.getConfiguration;h.vscode.workspace.getConfiguration=(...args)=>({...config(...args),update:()=>pending.promise});
    const request=h.panels[0].message(operation==='preference'?{type:operation,key:'style',value:'reading'}:{type:operation,text:'private data'});await new Promise(setImmediate);await h.action('open','/repo/docs/guide.md');const count=h.messages.length,warnings=h.warnings.length;
    if(operation==='preference')pending.reject(Error('private setting'));else pending.resolve(h.uri('/repo/result.csv'));await request;await new Promise(setImmediate);assert.equal(h.messages.length,count);assert.equal(h.warnings.length,warnings);assert.equal(writes.length,0);assert.equal(h.latest('render').preferences.style,'documentation');h.panels[0].dispose();
  }
});
