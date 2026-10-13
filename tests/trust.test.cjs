const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL,fileURLToPath} = require('node:url');
const {previewHost} = require('./preview-host.cjs');

function trustHost(t, options={}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'rmp-trust-'));
  const root = path.join(temporary,'workspace');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(temporary,'outside'));
  const inside = path.join(root,'guide.md');
  const sibling = path.join(root,'next.md');
  const outside = path.join(temporary,'outside','secret.md');
  fs.writeFileSync(inside,options.markdown ?? '# Safe Markdown');
  fs.writeFileSync(sibling,'# Workspace next');
  fs.writeFileSync(outside,'# Outside secret fixture');
  fs.symlinkSync(path.join(temporary,'outside'),path.join(root,'escape'),'junction');
  const file=value=>{
    const absolute=path.resolve(value),url=pathToFileURL(absolute);
    return {scheme:'file',authority:url.host,path:decodeURIComponent(url.pathname),fsPath:absolute,toString:()=>url.href};
  };
  const uri={file,parse:value=>/^file:/i.test(value)?file(fileURLToPath(value)):{scheme:value.split(':')[0],authority:'unsupported',path:'/unknown',toString:()=>value},joinPath:(base,...parts)=>file(path.resolve(base.fsPath??base.path,...parts))};
  const reads=[],stats=[],sourceReads=[];
  const document=target=>({uri:target,fileName:target.fsPath,languageId:'markdown',getText:()=>{sourceReads.push(target.fsPath);return fs.readFileSync(target.fsPath,'utf8');}});
  const host=previewHost({fileName:inside,workspaceTrusted:options.trusted??false,...options,initializeVscode:vscode=>{
    vscode.Uri=uri;
    vscode.window.activeTextEditor.document=document(file(inside));
    vscode.workspace.workspaceFolders=[{name:'fixture',uri:file(root)}];
    vscode.workspace.getWorkspaceFolder=target=>{
      if(target.scheme!=='file')return;
      const relative=path.relative(root,target.fsPath);
      return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?vscode.workspace.workspaceFolders[0]:undefined;
    };
    vscode.workspace.openTextDocument=async target=>{reads.push(target.fsPath);return document(target);};
    vscode.workspace.fs.stat=async target=>{stats.push(target.fsPath);return {type:fs.statSync(target.fsPath).isDirectory()?2:1};};
  }});
  t.after(()=>{
    host.handlers.dispose?.();
    for(const subscription of host.subscriptions) subscription.dispose?.();
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(temporary).startsWith('rmp-trust-'));
    fs.rmSync(temporary,{recursive:true,force:true});
  });
  return {...host,root,inside,sibling,outside,file,reads,stats,sourceReads};
}

test('Restricted Mode registered commands enforce containment before opening documents',async t=>{
  for(const command of ['richMarkdownPreview.openPreview','markdownLens.openPreview','styledMarkdown.openPreview']){
    const h=trustHost(t);
    for(const target of [h.file(h.outside),h.file(path.join(h.root,'escape','secret.md')),h.vscode.Uri.parse('vscode-remote://host/work/guide.md')])await h.handlers[command](target);
    assert.deepEqual(h.reads,[]);
    assert.equal(h.counts().created,0);
    assert.equal(h.warnings.length,3);
    await h.handlers[command](h.file(h.inside));
    assert.equal(h.counts().created,1);
    assert.deepEqual(h.reads,[h.inside]);
  }
});

test('Restricted Mode rejects unsafe links before reference discovery or source open',async t=>{
  const h=trustHost(t,{markdown:'# Safe\n\n[Outside](../outside/secret.md)\n\n[Symlink](escape/secret.md)\n\n{{include: ~/secret.md}}\n\n{{include: '+path.join(os.tmpdir(),'not-workspace.md').replaceAll('\\','/')+'}}'});
  await h.handlers.command(h.file(h.inside));
  const references=h.messages.find(message=>message.type==='render').references;
  for(const reference of references)await h.handlers.message({type:'reference',id:reference.id});
  await h.handlers.message({type:'link',href:'../outside/secret.md'});
  assert.deepEqual(h.stats,[]);
  assert.deepEqual(h.opened,[]);
  assert.deepEqual(h.reads,[h.inside]);
});

test('Restricted Mode ignores a root setting that would broaden navigation, preserving workspace references',async t=>{
  const h=trustHost(t,{markdown:'# Safe\n\n{{include: /next.md}}',initial:{referenceRoot:os.tmpdir()}});
  await h.handlers.command(h.file(h.inside));
  const original=h.configuration.get;
  h.configuration.get=(key,...args)=>{assert.notEqual(key,'referenceRoot','Restricted host must ignore the root setting entirely');return original(key,...args);};
  await h.handlers.message({type:'reference',id:'reference-0'});
  assert.deepEqual(h.stats,[h.sibling]);
  assert.equal(h.opened.length,1);
});

test('Trusted command behavior retains intentional outside-workspace navigation',async t=>{
  const h=trustHost(t,{trusted:true});
  await h.handlers.command(h.file(h.outside));
  assert.equal(h.counts().created,1);
  assert.deepEqual(h.reads,[h.outside]);
});

test('Restricted Mode rejects an already-open outside editor before reading its Markdown',async t=>{
  const h=trustHost(t);
  let sourceReads=0;
  h.vscode.window.activeTextEditor.document={uri:h.file(h.outside),fileName:h.outside,languageId:'markdown',getText:()=>{sourceReads++;return '# Outside';}};
  await h.handlers.command();
  assert.equal(sourceReads,0);
  assert.equal(h.counts().created,0);
  assert.deepEqual(h.reads,[]);
});

test('Restricted Mode rechecks containment after a pending document read before creating a panel',async t=>{
  const h=trustHost(t);
  let resolve;
  const pending=new Promise(yes=>{resolve=yes;});
  const document=h.vscode.window.activeTextEditor.document;
  h.vscode.workspace.openTextDocument=target=>{h.reads.push(target.fsPath);return pending;};
  const opening=h.handlers.command(h.file(h.inside));
  h.vscode.workspace.getWorkspaceFolder=()=>undefined;
  resolve(document);
  await opening;
  assert.equal(h.counts().created,0);
  assert.deepEqual(h.reads,[h.inside],'The initial safe read was issued before the workspace changed');
});

test('Restricted Mode blocks saved origins and direct grants; trust suspends old approvals until explicit persisted consent',async t=>{
  const origin='https://trust-test.invalid',other='https://other-trust.invalid';
  const h=trustHost(t,{markdown:'# Safe\n\n![Remote]('+origin+'/beacon.svg)',imageOrigins:[origin,other]});
  await h.handlers.command(h.file(h.inside));
  const render=()=>h.messages.filter(message=>message.type==='render').at(-1);
  assert.equal(h.trustRegistrations(),1);
  assert.ok(!render().html.includes('<img'));
  assert.ok(!render().html.includes('data-external-image-action'));
  assert.ok(!h.panel.webview.html.includes(origin));
  await h.handlers.message({type:'grantExternalImageOrigin',origin});
  assert.equal(h.imageWrites.length,0);assert.equal(h.warnings.length,0);
  let resets=0,shell=h.panel.webview.html;
  Object.defineProperty(h.panel.webview,'html',{get:()=>shell,set:value=>{resets++;shell=value;},configurable:true});
  h.fireTrust();assert.equal(resets,0,'False trust event is ignored');
  h.vscode.workspace.isTrusted=true;h.fireTrust();assert.equal(resets,1);
  assert.ok(!shell.includes(origin));assert.ok(!shell.includes(other));
  await h.handlers.message({type:'ready'});
  assert.ok(!render().html.includes('<img'));
  assert.equal((render().html.match(/data-external-image-action="grant"/g)??[]).length,1);
  assert.deepEqual(h.imageState.value,[origin,other]);
  h.fireTrust();assert.equal(resets,1,'Repeated grant event creates no additional reset or listener');
  await h.handlers.message({type:'grantExternalImageOrigin',origin});
  assert.equal(h.imageWrites.length,1);assert.equal(resets,2);
  assert.ok(shell.includes(origin));assert.ok(!shell.includes(other));
  await h.handlers.message({type:'ready'});
  assert.ok(render().html.includes('src="'+origin+'/beacon.svg"'));
  h.handlers.dispose();h.fireTrust();assert.equal(resets,2);
});

test('Failed post-trust reallow cannot unsuspend a previously saved origin',async t=>{
  const origin='https://trust-test.invalid';
  const h=trustHost(t,{markdown:'![Remote]('+origin+'/beacon.svg)',imageOrigins:[origin],failImageWrites:true});
  await h.handlers.command(h.file(h.inside));
  h.vscode.workspace.isTrusted=true;h.fireTrust();await h.handlers.message({type:'ready'});
  await h.handlers.message({type:'grantExternalImageOrigin',origin});
  h.handlers.view();await h.drain();
  assert.ok(!h.panel.webview.html.includes(origin));
  assert.ok(!h.messages.filter(message=>message.type==='render').at(-1).html.includes('<img'));
  assert.equal(h.imageWrites.length,1);
  assert.ok(h.warnings.some(value=>value.includes('permission could not be saved')));
});

test('Workspace removal drops resource roots and source reads; failed root update disposes the panel',async t=>{
  const h=trustHost(t);
  await h.handlers.command(h.file(h.inside));
  let sourceReads=0;
  h.sourceReads.length=0;
  const document=h.vscode.window.activeTextEditor.document;
  document.getText=()=>{sourceReads++;return '# No further read';};
  h.vscode.workspace.getWorkspaceFolder=()=>undefined;
  h.handlers.folders();
  assert.equal(h.panel.webview.options.localResourceRoots.length,2);
  const messages=h.messages.length;
  h.handlers.text({document});h.handlers.view();await h.handlers.message({type:'ready'});
  await h.handlers.message({type:'copy',text:'forbidden'});
  assert.equal(sourceReads,0);assert.deepEqual(h.sourceReads,[]);assert.equal(h.messages.length,messages);assert.equal(h.clipboard.length,0);
  const failed=trustHost(t,{trusted:true});await failed.handlers.command(failed.file(failed.inside));
  Object.defineProperty(failed.panel.webview,'options',{set(){throw Error('secret provider failure');},configurable:true});
  failed.handlers.folders();
  assert.ok(failed.diagnostics.some(value=>value.includes('update preview resource roots')));
  assert.ok(!failed.diagnostics.join('\n').includes('secret'));
  const prior=failed.messages.length;await failed.handlers.message({type:'ready'});assert.equal(failed.messages.length,prior);
});

const {host:homeHost}=require('./documentation-host.cjs');
test('Restricted Home preserves safe browsing and rejects a target losing permission during a read',async()=>{
  const h=homeHost({trusted:false});await h.open();await h.action('open','/repo/README.md');
  assert.equal(h.latest('render').documentId,'file:///repo/README.md');
  let resolve;const pending=new Promise(yes=>{resolve=yes;});
  h.vscode.workspace.openTextDocument=()=>pending;
  const navigation=h.action('open','/repo/docs/guide.md');
  const folder=h.vscode.workspace.getWorkspaceFolder;
  h.vscode.workspace.getWorkspaceFolder=target=>target.path==='/repo/docs/guide.md'?undefined:folder(target);
  resolve(h.getDocument(h.uri('/repo/docs/guide.md')));await navigation;
  assert.equal(h.latest('render').documentId,'file:///repo/README.md');
  assert.deepEqual(h.opened,[]);h.panels[0].dispose();
});

test('Restricted source opening validates the returned document before reading or revealing it',async()=>{
  const h=homeHost({trusted:false});await h.openSingle();let reads=0;
  h.vscode.workspace.openTextDocument=async()=>({uri:h.uri('/private/unexpected.md'),getText(){reads++;return '# Must not read';}});
  await h.panels[0].message({type:'link',href:'docs/guide.md#details'});
  assert.equal(reads,0);assert.deepEqual(h.opened,[]);h.panels[0].dispose();
});

test('Restricted Home source command rechecks permission immediately before the editor action',async()=>{
  const h=homeHost({trusted:false});await h.open();await h.action('open','/repo/README.md');
  const folder=h.vscode.workspace.getWorkspaceFolder;let calls=0;
  h.vscode.workspace.getWorkspaceFolder=target=>target.path==='/repo/README.md'&&++calls>1?undefined:folder(target);
  await h.action('source');assert.deepEqual(h.opened,[]);assert.ok(h.warnings.some(value=>value.includes('Restricted Mode')));h.panels[0].dispose();
});
