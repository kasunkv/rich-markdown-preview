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
  const reads=[],stats=[];
  const document=target=>({uri:target,fileName:target.fsPath,languageId:'markdown',getText:()=>fs.readFileSync(target.fsPath,'utf8')});
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
  return {...host,root,inside,sibling,outside,file,reads,stats};
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
