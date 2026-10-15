const {test} = require('node:test');
const assert = require('node:assert/strict');
const {previewHost} = require('./preview-host.cjs');
const {host:documentationHost} = require('./documentation-host.cjs');
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const csv = '"Name","Value"\r\n"Formula","=SUM(1)"\r\n';
const latestRender = host => host.messages.filter(message=>message.type==='render').at(-1);
const correlated = (host,value,requestId='security_1') => ({requestId,renderId:latestRender(host).renderId,...value});
async function open(options) {const host=previewHost(options);await host.handlers.command();await host.handlers.message({type:'ready'});return host;}
test('authoritative ingress rejects hostile messages before any privileged API',async()=>{
 const host=await open(); const base=correlated(host,{type:'copy',text:'text'});
 const inputs=[null,[],{},Object.assign(Object.create({type:'copy'}),base),JSON.parse('{"type":"copy","__proto__":{}}'),{get type(){throw Error('must not read');}}, {...base,type:'unknown'}, {...base,text:'x'.repeat(4194305)}, {...base,text:'\x00'}, {...base,requestId:'bad\n'}, {...base,renderId:'stale'}, {...base,extra:true}, {...base,type:'preference',key:'style',value:'invalid'}, {...base,type:'link',href:'command:evil'}, {...base,type:'link',href:'a%00.md'}, {...base,type:'link',href:'https://user:pass@example.com'}, {...base,type:'link',href:'x'.repeat(8193)}, {...base,type:'reference',id:'forged'}, {...base,type:'tableExport',text:'unsafe',filename:'table-1.csv'}, {...base,type:'tableExport',text:'""\r\n'.repeat(100001),filename:'table-1.csv'}, {...base,type:'tableExport',text:Array(1001).fill('""').join(',')+'\r\n',filename:'table-1.csv'}, {...base,type:'tableExport',text:csv,filename:'../outside.csv'}];
 for(const input of inputs) await host.handlers.rawMessage(input);
 assert.equal(host.clipboard.length,0);assert.equal(host.files.length,0);assert.equal(host.dialogs.length,0);assert.equal(host.opened.length,0);assert.equal(host.external.length,0);assert.equal(host.writes.length,0);assert.equal(host.warnings.length,0);
 host.handlers.dispose();
});
test('large CSV actions enforce formula policy and correlate overlapping completions',async()=>{
 const host=await open();const calls=[];const pending=[deferred(),deferred()];host.vscode.env.clipboard.writeText=text=>{calls.push(text);return pending[calls.length-1].promise;};
 const large=csv.replace('Name','Name'.repeat(6)).repeat(40000);assert.ok(large.length>2*1024*1024);
 const first=host.handlers.rawMessage(correlated(host,{type:'tableCopy',text:large,filename:'table-1.csv'},'large_first'));
 const second=host.handlers.rawMessage(correlated(host,{type:'tableCopy',text:csv,filename:'table-2.csv'},'large_second'));
 await host.drain();assert.equal(calls.length,2);assert.match(calls[0],/\'=SUM/);
 pending[1].resolve();await second;pending[0].resolve();await first;
 const results=host.messages.filter(message=>message.type==='tableActionResult');assert.deepEqual(results.map(message=>message.requestId),['large_second','large_first']);assert.ok(results.every(message=>message.success));
 host.handlers.dispose();
});
test('CSV export success, cancellation and failure remain correlated and readable',async()=>{
 for(const options of [{},{cancelExport:true},{failExport:true},{failCopy:true}]){
  const host=await open(options);const type=options.failCopy?'tableCopy':'tableExport';await host.handlers.rawMessage(correlated(host,{type,text:csv,filename:'table-1.csv'},'export_request'));
  const result=host.messages.at(-1);assert.equal(result.type,'tableActionResult');assert.equal(result.requestId,'export_request');assert.equal(result.action,type);
  if(options.cancelExport)assert.equal(result.cancelled,true);else assert.equal(result.success,!options.failExport&&!options.failCopy);
  if(!Object.keys(options).length){assert.equal(host.files.length,1);assert.match(host.files[0].text,/^\uFEFF/);assert.match(host.files[0].text,/\'=SUM/);}
  if(options.failExport||options.failCopy){assert.match(result.error,/Check clipboard or destination/);assert.ok(!result.error.includes('Disk is read-only'));}
  host.handlers.dispose();
 }
});
test('source changes reject stale IDs and pending save destinations',async()=>{
 const host=await open();const old=latestRender(host).renderId;const pending=deferred();host.vscode.window.showSaveDialog=()=>pending.promise;
 const request=host.handlers.rawMessage(correlated(host,{type:'tableExport',text:csv,filename:'table-1.csv'},'pending_export'));await host.drain();
 host.document.getText=()=> '# Changed';host.handlers.text({document:host.document});pending.resolve(host.document.uri);await request;
 for(const value of [{type:'copy',text:'stale'},{type:'tableCopy',text:csv,filename:'table-1.csv'},{type:'link',href:'https://example.com'},{type:'preference',key:'style',value:'book'},{type:'reference',id:'reference-0'}])await host.handlers.rawMessage({requestId:'stale_request',renderId:old,...value});
 assert.equal(host.files.length,0);assert.equal(host.clipboard.length,0);assert.equal(host.external.length,0);assert.equal(host.writes.length,0);host.handlers.dispose();
});
test('rendered references and index allowlists survive message contracts',async()=>{
 const host=await open();host.document.getText=()=> '{{include: old.md}}';await host.handlers.message({type:'ready'});const old=latestRender(host);
 host.document.getText=()=> '{{include: new.md}}';host.handlers.text({document:host.document});await host.handlers.message({type:'ready'});
 await host.handlers.rawMessage({type:'reference',id:old.references[0].id,renderId:old.renderId,requestId:'stale_reference'});assert.equal(host.opened.length,0);
 await host.handlers.rawMessage(correlated(host,{type:'reference',id:latestRender(host).references[0].id},'fresh_reference'));assert.equal(host.opened.length,1);host.handlers.dispose();
 const home=documentationHost();await home.open();const render=home.latest('render');await home.panels[0].rawMessage({type:'documentationAction',action:'open',id:'file:///repo/forged.md',renderId:render.renderId,requestId:'forged_index'});assert.equal(home.reads.length,0);home.panels[0].dispose();
});
test('rapid preferences retain the same model identity and serialized newest commit',async()=>{
 const host=await open();const id=latestRender(host).renderId;const pending=deferred();const original=host.configuration.update;let call=0;
 host.configuration.update=async(...args)=>{if(++call===1)await pending.promise;return original(...args);};
 await host.handlers.rawMessage(correlated(host,{type:'preference',key:'fontSize',value:17},'preference_first'));
 await host.handlers.rawMessage(correlated(host,{type:'preference',key:'fontSize',value:17.5},'preference_second'));
 await host.drain();pending.resolve();await host.drain();await host.drain();
 assert.deepEqual(host.writes.map(write=>write.value),[17,17.5]);assert.equal(host.saved.fontSize,17.5);
 host.handlers.view();await host.drain();assert.equal(latestRender(host).renderId,id);host.handlers.dispose();
});

test('rendered paths enforce decoded scheme/control/size policy before opens',async()=>{
 const host=previewHost({inWorkspace:false});host.document.getText=()=> '{{include: %63ommand:evil.md}}\n\n{{include: %2f%2fexample.com/a.md}}\n\n{{include: %00bad.md}}\n\n{{include: %7fbad.md}}\n\n{{include: '+ 'a'.repeat(8193) + '.md}}\n\n{{include: https://user:pass@example.com/private.md}}';await host.handlers.command();
 const render=latestRender(host);assert.equal(render.references.length,6);
 for(const reference of render.references)await host.handlers.rawMessage(correlated(host,{type:'reference',id:reference.id},'path_'+reference.id));
 assert.equal(host.opened.length,0);assert.equal(host.external.length,0);assert.equal(host.files.length,0);host.handlers.dispose();
 const rooted=previewHost({inWorkspace:false,initial:{referenceRoot:'C:/root'}});rooted.document.getText=()=> '{{include: /valid.md}}';rooted.vscode.Uri.file=value=>({path:value,toString:()=> 'file://'+value});await rooted.handlers.command();await rooted.handlers.message({type:'reference',id:latestRender(rooted).references[0].id});
 if(process.platform==='win32') assert.match(rooted.opened[0].uri,/C:\/root\/valid.md$/);
 else {
  assert.equal(rooted.opened.length,0);
  assert.ok(rooted.warnings.some(message=>message.includes('Windows absolute paths require a Windows extension host')));
 }
 rooted.handlers.dispose();
});
test('local URI provider failures retain redacted guards and drop stale warnings',async()=>{
 for(const stale of [false,true]){
  const host=await open();host.vscode.Uri.joinPath=()=>{if(stale){host.document.getText=()=> '# Changed';host.handlers.text({document:host.document});}throw Error('private URI provider detail');};
  await host.handlers.rawMessage(correlated(host,{type:'link',href:'guide.md'},'uri_provider'));
  assert.equal(host.opened.length,0);assert.equal(host.warnings.length,stale?0:1);assert.ok(!host.diagnostics.join('\n').includes('private URI provider detail'));host.handlers.dispose();
 }
});
test('Home navigation checks missing history and removed workspace roots',async()=>{
 const home=documentationHost();await home.open();for(const action of ['source','back','forward'])await home.action(action);assert.equal(home.opened.length,0);
 home.vscode.workspace.workspaceFolders=[];home.configuration.fire({affectsConfiguration:()=>true});await home.action('home');assert.equal(home.latest('render').documentId,'home');assert.equal(home.latest('render').preferences.style,'documentation');home.panels[0].dispose();
 const closed=previewHost();closed.subscriptions.find(value=>typeof value.capture==='function').dispose();await closed.handlers.command();assert.equal(closed.counts().created,0);
});
test('source revisions reject pending Home source and refresh follow-up work',async()=>{
 for(const operation of ['source','refresh']){
  const home=documentationHost();await home.open();await home.action('open','/repo/README.md');const pending=deferred();
  if(operation==='source')home.vscode.window.showTextDocument=()=>pending.promise;else home.vscode.workspace.findFiles=()=>pending.promise;
  const request=home.action(operation);await new Promise(setImmediate);home.files.set('/repo/README.md','# Edited');home.text.fire({document:home.getDocument(home.uri('/repo/README.md'))});pending.resolve(operation==='source'?{}:[]);await request;
  assert.equal(home.opened.length,0);home.panels[0].dispose();
 }
});
