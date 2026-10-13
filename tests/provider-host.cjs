const assert = require('node:assert/strict');

// An actual FileSystemProvider in the isolated desktop host, never a URI mock.
let fixture;
exports.registerProviderFixture = (vscode) => {
  const scheme='rmp-readonly';
  const data=new Map([
    ['/one/README.md','# Provider One\n\n![Provider authorized](assets/image.svg?v=3#view)\n\n![Provider missing](assets/missing.svg)\n\n![Provider escape](../private.svg)\n\n![Provider symlink](alias/secret.svg)\n\n[Provider target](docs/target.md#details)\n\n[Missing provider](docs/missing.md#details)\n\n{{include: /docs/target.md#details}}\n\n| Name | Value |\n| --- | --- |\n| fixture | 1 |'],
    ['/one/docs/target.md','# Provider Target\n\n## Details\n\nProvider content.'],
    ['/one/.hidden/guide.md','# Hidden provider guide'],
    ['/two/README.md','# Provider Two'],
    ['/one/assets/image.svg','<svg xmlns="http://www.w3.org/2000/svg" width="53" height="29"><rect width="53" height="29" fill="blue"/></svg>'],
    ['/one/alias/secret.svg','<svg xmlns="http://www.w3.org/2000/svg" width="99" height="99"/>'],
    ['/one/alias/private.md','# Must not discover'],
    ['/private.svg','<svg xmlns="http://www.w3.org/2000/svg" width="99" height="99"/>'],
  ]);
  const files=new Map([...data].map(([key,value])=>[key,Buffer.from(value)]));
  const directories=new Set(['/']);
  for(const name of files.keys()){let parent=name.slice(0,name.lastIndexOf('/'));while(parent){directories.add(parent);parent=parent.slice(0,parent.lastIndexOf('/'));}}
  const reads=[],stats=[];
  const emitter=new vscode.EventEmitter();
  const provider={onDidChangeFile:emitter.event,watch:()=>({dispose(){}}),stat:uri=>{stats.push(uri.toString());if(uri.path==='/one/alias')return {type:66,ctime:0,mtime:0,size:0};if(files.has(uri.path))return {type:vscode.FileType.File,ctime:0,mtime:0,size:files.get(uri.path).length};if(directories.has(uri.path))return {type:vscode.FileType.Directory,ctime:0,mtime:0,size:0};throw vscode.FileSystemError.FileNotFound(uri);},readFile:uri=>{reads.push(uri.toString());const bytes=files.get(uri.path);if(!bytes)throw vscode.FileSystemError.FileNotFound(uri);return bytes;},readDirectory:uri=>{if(!directories.has(uri.path))throw vscode.FileSystemError.FileNotFound(uri);const prefix=uri.path.replace(/\/$/,'')+'/';return [...directories,...files.keys()].filter(name=>name.startsWith(prefix)&&!name.slice(prefix.length).includes('/')).map(name=>[name.slice(prefix.length),name==='/one/alias'?66:directories.has(name)?vscode.FileType.Directory:vscode.FileType.File]);},writeFile(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},delete(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},rename(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},createDirectory(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');}};
  const registration=vscode.workspace.registerFileSystemProvider(scheme,provider,{isCaseSensitive:true,isReadonly:true});
  const first=vscode.Uri.parse(`${scheme}://fixture/one`),second=vscode.Uri.parse(`${scheme}://fixture/two`),guide=vscode.Uri.joinPath(first,'README.md'),target=vscode.Uri.joinPath(first,'docs','target.md');
  return fixture={scheme,first,second,guide,target,reads,stats,registration,emitter};
};
exports.proveProviders = async ({vscode,findFrame,checks}) => {
  const {scheme,first,second,guide,target,reads,stats,registration,emitter}=fixture;
  assert.equal(vscode.workspace.workspaceFolders.filter(root=>root.uri.scheme===scheme).length,2);
  try {
    assert.equal(vscode.workspace.fs.isWritableFileSystem(scheme),false);
    const opened=await vscode.workspace.openTextDocument(guide);assert.equal(opened.uri.scheme,scheme);assert.equal(opened.uri.authority,'fixture');
    for(const mode of ['single-file','documentation-home']){
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if(mode==='single-file')await vscode.commands.executeCommand('richMarkdownPreview.openPreview',guide);
      else {
        await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');const home=await findFrame('input[aria-label="Filter documentation"]');
        await home.locator('input[aria-label="Filter documentation"]').fill('');
        await home.waitForFunction(()=>[...document.querySelectorAll('button.documentation-file')].some(button=>button.dataset.key==='rmp-readonly://fixture/one/.hidden/guide.md'));
        const allTargets=await home.locator('button.documentation-file').evaluateAll(buttons=>buttons.map(button=>button.dataset.key));assert.ok(!allTargets.some(value=>value.includes('/alias/private.md')));checks.push({hiddenProviderDiscovery:'rmp-readonly://fixture/one/.hidden/guide.md',reportedSymlinkPruned:true});
        await home.locator('input[aria-label="Filter documentation"]').fill('README.md');
        await home.waitForFunction(()=>[...document.querySelectorAll('button.documentation-file')].some(button=>button.dataset.key==='rmp-readonly://fixture/one/README.md'));
        const listing=await home.locator('button.documentation-file').evaluateAll(buttons=>buttons.map(button=>button.dataset.key));assert.ok(listing.includes(guide.toString()));assert.ok(listing.includes(vscode.Uri.joinPath(second,'README.md').toString()));
        await home.locator('button.documentation-file[data-key='+JSON.stringify(guide.toString())+']').click();
        checks.push({providerDiscovery:listing});
      }
      const frame=await findFrame('#rmp-ui-content img[alt="Provider authorized"]');
      await frame.waitForFunction(()=>document.querySelector('img[alt="Provider authorized"]')?.naturalWidth===53);
      const images=await frame.evaluate(()=>[...document.querySelectorAll('#rmp-ui-content img')].map(image=>({alt:image.alt,src:image.getAttribute('src'),width:image.naturalWidth})));
      assert.equal(images.find(image=>image.alt==='Provider missing').src,'');assert.equal(images.find(image=>image.alt==='Provider escape').src,'');assert.equal(images.find(image=>image.alt==='Provider symlink').src,'');assert.ok(!reads.some(value=>value.endsWith('/private.svg')));
      checks.push({mode,actualProviderImages:images,providerUri:guide.toString()});
      await frame.locator('.table-export').click();
      await frame.waitForFunction(()=>document.querySelector('#rmp-ui-announcement')?.textContent.includes('CSV export is unavailable'));
      checks.push({mode,providerExport:'explicitly unsupported; Copy CSV available'});
      await frame.locator('#rmp-ui-content a').filter({hasText:'Missing provider'}).click();
      const missingDeadline=Date.now()+10000;while(!stats.some(uri=>uri==='rmp-readonly://fixture/one/docs/missing.md')&&Date.now()<missingDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(stats.some(uri=>uri==='rmp-readonly://fixture/one/docs/missing.md'));assert.ok(!reads.some(uri=>uri.endsWith('/docs/missing.md')));checks.push({mode,missingProviderReference:'stat rejects before source read'});
      if(mode==='single-file'){await frame.locator('#rmp-ui-content a').filter({hasText:'/docs/target.md#details'}).click();const deadline=Date.now()+10000;while(vscode.window.activeTextEditor?.document.uri.toString()!==target.toString()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),target.toString());checks.push({rootRelativeProviderReference:target.toString()});}
      if(mode==='documentation-home')await frame.locator('#rmp-ui-content a').filter({hasText:'Provider target'}).click();
      if(mode==='single-file'){
        const deadline=Date.now()+10000;while(vscode.window.activeTextEditor?.document.uri.toString()!==target.toString()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),target.toString());assert.equal(vscode.window.activeTextEditor.selection.start.line,2);
      } else await frame.waitForFunction(()=>document.querySelector('#rmp-ui-content h1')?.textContent==='Provider Target');
    }
    checks.push({providerReadUris:reads,providerRoots:[first.toString(),second.toString()],readOnly:true});
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    registration.dispose();emitter.dispose();
  }
};



exports.proveRestrictedProviders=async({vscode,findFrame,checks})=>{
 assert.equal(vscode.workspace.isTrusted,false,'Actual host is in Restricted Mode');
 const {guide,reads}=fixture;
 const before=reads.filter(uri=>uri.includes('/README.md')).length;
 await vscode.commands.executeCommand('richMarkdownPreview.openPreview',guide);
 assert.equal(reads.filter(uri=>uri.includes('/README.md')).length,before,'Restricted command does not read opaque provider Markdown');
 assert.ok(!vscode.window.tabGroups.all.flatMap(group=>group.tabs).some(tab=>tab.input instanceof vscode.TabInputWebview),'No opaque provider preview is created');
 await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
 const frame=await findFrame('input[aria-label="Filter documentation"]');
 await frame.locator('input[aria-label="Filter documentation"]').fill('Provider One');
 await frame.waitForFunction(()=>document.body.textContent.includes('No matching documents.'));
 const targets=await frame.locator('button.documentation-file').evaluateAll(buttons=>buttons.map(button=>button.dataset.key));
 assert.ok(!targets.some(value=>value.startsWith('rmp-readonly:')));
 assert.equal(reads.filter(uri=>uri.includes('/README.md')).length,before);
 checks.push({actualTrust:false,opaqueProviderCommand:'blocked before source read',opaqueProviderDiscovery:targets});
};
