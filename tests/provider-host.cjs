const assert = require('node:assert/strict');

// An actual FileSystemProvider in the isolated desktop host, never a URI mock.
exports.proveProviders = async ({vscode,findFrame,checks}) => {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const scheme='rmp-readonly';
  const data=new Map([
    ['/one/README.md','# Provider One\n\n![Provider authorized](assets/image.svg?v=3#view)\n\n![Provider missing](assets/missing.svg)\n\n![Provider escape](../private.svg)\n\n[Provider target](docs/target.md#details)\n\n{{include: /docs/target.md#details}}\n\n| Name | Value |\n| --- | --- |\n| fixture | 1 |'],
    ['/one/docs/target.md','# Provider Target\n\n## Details\n\nProvider content.'],
    ['/one/.hidden/guide.md','# Hidden provider guide'],
    ['/two/README.md','# Provider Two'],
    ['/one/assets/image.svg','<svg xmlns="http://www.w3.org/2000/svg" width="53" height="29"><rect width="53" height="29" fill="blue"/></svg>'],
    ['/private.svg','<svg xmlns="http://www.w3.org/2000/svg" width="99" height="99"/>'],
  ]);
  const files=new Map([...data].map(([key,value])=>[key,Buffer.from(value)]));
  const directories=new Set(['/']);
  for(const name of files.keys()){let parent=name.slice(0,name.lastIndexOf('/'));while(parent){directories.add(parent);parent=parent.slice(0,parent.lastIndexOf('/'));}}
  const reads=[];
  const emitter=new vscode.EventEmitter();
  const provider={onDidChangeFile:emitter.event,watch:()=>({dispose(){}}),stat:uri=>{if(files.has(uri.path))return {type:vscode.FileType.File,ctime:0,mtime:0,size:files.get(uri.path).length};if(directories.has(uri.path))return {type:vscode.FileType.Directory,ctime:0,mtime:0,size:0};throw vscode.FileSystemError.FileNotFound(uri);},readFile:uri=>{reads.push(uri.toString());const bytes=files.get(uri.path);if(!bytes)throw vscode.FileSystemError.FileNotFound(uri);return bytes;},readDirectory:uri=>{if(!directories.has(uri.path))throw vscode.FileSystemError.FileNotFound(uri);const prefix=uri.path.replace(/\/$/,'')+'/';return [...directories,...files.keys()].filter(name=>name.startsWith(prefix)&&!name.slice(prefix.length).includes('/')).map(name=>[name.slice(prefix.length),directories.has(name)?vscode.FileType.Directory:vscode.FileType.File]);},writeFile(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},delete(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},rename(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');},createDirectory(){throw vscode.FileSystemError.NoPermissions('Read-only fixture');}};
  const registration=vscode.workspace.registerFileSystemProvider(scheme,provider,{isCaseSensitive:true,isReadonly:true});
  const first=vscode.Uri.parse(`${scheme}://fixture/one`),second=vscode.Uri.parse(`${scheme}://fixture/two`),guide=vscode.Uri.joinPath(first,'README.md'),target=vscode.Uri.joinPath(first,'docs','target.md');
  const start=vscode.workspace.workspaceFolders.length;
  const changed=new Promise(resolve=>{const listener=vscode.workspace.onDidChangeWorkspaceFolders(()=>{listener.dispose();resolve();});});
  assert.ok(vscode.workspace.updateWorkspaceFolders(start,0,{uri:first,name:'Provider One'},{uri:second,name:'Provider Two'}));await changed;
  try {
    assert.equal(vscode.workspace.fs.isWritableFileSystem(scheme),false);
    const opened=await vscode.workspace.openTextDocument(guide);assert.equal(opened.uri.scheme,scheme);assert.equal(opened.uri.authority,'fixture');
    for(const mode of ['single-file','documentation-home']){
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if(mode==='single-file')await vscode.commands.executeCommand('richMarkdownPreview.openPreview',guide);
      else {
        await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');const home=await findFrame('input[aria-label="Filter documentation"]');
        await home.locator('input[aria-label="Filter documentation"]').fill('README.md');
        await home.waitForFunction(()=>[...document.querySelectorAll('button.documentation-file')].some(button=>button.dataset.key==='rmp-readonly://fixture/one/README.md'));
        const listing=await home.locator('button.documentation-file').evaluateAll(buttons=>buttons.map(button=>button.dataset.key));assert.ok(listing.includes(guide.toString()));assert.ok(listing.includes(vscode.Uri.joinPath(second,'README.md').toString()));
        await home.locator('button.documentation-file[data-key='+JSON.stringify(guide.toString())+']').click();
        checks.push({providerDiscovery:listing});
      }
      const frame=await findFrame('#rmp-ui-content img[alt="Provider authorized"]');
      await frame.waitForFunction(()=>document.querySelector('img[alt="Provider authorized"]')?.naturalWidth===53);
      const images=await frame.evaluate(()=>[...document.querySelectorAll('#rmp-ui-content img')].map(image=>({alt:image.alt,src:image.getAttribute('src'),width:image.naturalWidth})));
      assert.equal(images.find(image=>image.alt==='Provider missing').src,'');assert.equal(images.find(image=>image.alt==='Provider escape').src,'');assert.ok(!reads.some(value=>value.endsWith('/private.svg')));
      checks.push({mode,actualProviderImages:images,providerUri:guide.toString()});
      await frame.locator('.table-export').click();
      await frame.waitForFunction(()=>document.querySelector('#rmp-ui-announcement')?.textContent.includes('CSV export is unavailable'));
      checks.push({mode,providerExport:'explicitly unsupported; Copy CSV available'});
      await frame.locator('#rmp-ui-content a').filter({hasText:'Provider target'}).click();
      if(mode==='single-file'){
        const deadline=Date.now()+10000;while(vscode.window.activeTextEditor?.document.uri.toString()!==target.toString()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(vscode.window.activeTextEditor?.document.uri.toString(),target.toString());assert.equal(vscode.window.activeTextEditor.selection.start.line,2);
      } else await frame.waitForFunction(()=>document.querySelector('#rmp-ui-content h1')?.textContent==='Provider Target');
    }
    checks.push({providerReadUris:reads,providerRoots:[first.toString(),second.toString()],readOnly:true});
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const changed=new Promise(resolve=>{const listener=vscode.workspace.onDidChangeWorkspaceFolders(()=>{listener.dispose();resolve();});});vscode.workspace.updateWorkspaceFolders(start,2);await changed;
    registration.dispose();emitter.dispose();
  }
};


