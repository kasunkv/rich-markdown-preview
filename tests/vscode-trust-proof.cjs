const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.prove = async ({vscode,workspace,browser,findFrame,wait,checks,mode,grantFixtureTrust}) => {
  const directory = path.dirname(workspace);
  const outside = vscode.Uri.file(path.join(directory,'outside.md'));
  const uri = vscode.Uri.file(path.join(workspace,'trust-proof.md'));
  const remoteOrigin = 'https://trust-preview.invalid';
  const requests = [];
  const localImage = '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="13"><rect width="29" height="13" fill="green"/></svg>';
  for(const context of browser.contexts()) await context.route(remoteOrigin+'/**',async route=>{
    requests.push(route.request().url());
    await route.fulfill({status:200,contentType:'image/svg+xml',body:localImage});
  });
  await fs.writeFile(outside.fsPath,'# Forbidden fixture\n');
  await fs.mkdir(path.join(directory,'outside'),{recursive:true});
  await fs.writeFile(path.join(directory,'outside','secret.md'),'# Canonical escape fixture\n');
  await fs.symlink(path.join(directory,'outside'),path.join(workspace,'escape'),'junction');
  await fs.mkdir(path.join(workspace,'assets'),{recursive:true});
  await fs.writeFile(path.join(workspace,'assets','trust-local.svg'),localImage);
  await fs.mkdir(path.join(workspace,'.vscode'),{recursive:true});
  await fs.writeFile(path.join(workspace,'.vscode','settings.json'),JSON.stringify({
    'richMarkdownPreview.referenceRoot':directory,
    'markdownLens.referenceRoot':directory,
    'styledMarkdown.referenceRoot':directory,
    'richMarkdownPreview.openPreviewToSide':false,
  }));
  await fs.writeFile(uri.fsPath,'# Trust proof\n\n![Safe local](assets/trust-local.svg)\n\n![Remote beacon]('+remoteOrigin+'/beacon.svg)\n\n[Workspace](test.md)\n\n[Escape](../outside.md)\n\n[Symlink](escape/secret.md)\n\n{{include: ~/outside.md}}\n\n{{include: '+outside.fsPath.replaceAll('\\','/')+'}}\n\n{{include: /test.md}}');
  await wait(()=>vscode.workspace.getConfiguration('richMarkdownPreview',uri).get('referenceRoot') === '', 'Restricted workspace referenceRoot is ignored');
  checks.push('Host configuration ignores unsafe workspace referenceRoot; manifest restricts legacy aliases');
  const previews = ()=>vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>tab.input instanceof vscode.TabInputWebview);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  for(const command of ['richMarkdownPreview.openPreview','markdownLens.openPreview','styledMarkdown.openPreview']){
    await vscode.commands.executeCommand(command,outside);
    assert.equal(previews().length,0,'Direct outside command denied: '+command);
    await vscode.commands.executeCommand(command,vscode.Uri.file(path.join(workspace,'escape','secret.md')));
    assert.equal(previews().length,0,'Direct symlink command denied: '+command);
  }
  checks.push('All registered preview command aliases deny outside and canonical escape targets in actual Restricted Mode');
  await vscode.commands.executeCommand('richMarkdownPreview.openPreview',uri);
  let frame = await findFrame('#rmp-ui-content img[alt="Safe local"]');
  await frame.waitForFunction(()=>document.querySelector('img[alt="Safe local"]')?.naturalWidth === 29);
  assert.equal(await frame.locator('.external-image-blocked').count(),1);
  assert.equal(await frame.locator('[data-external-image-action="grant"]').count(),0,'Restricted UI offers no remote grant');
  assert.equal(await frame.evaluate(origin=>document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes(origin),remoteOrigin),false);
  assert.equal(requests.length,0);
  for(const selector of ['a[href="../outside.md"]','a[href="escape/secret.md"]','a[href="~/outside.md"]',`a[href="${outside.fsPath.replaceAll('\\','/')}"]`]) {
    await frame.locator(selector).click();
    assert.equal(await frame.locator('#rmp-ui-content h1').textContent(),'Trust proof');
    assert.ok(!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document.getText().includes('Forbidden fixture'));
  }
  checks.push('Safe local image loads; remote images/CSP and unsafe relative, home, absolute and symlink navigation remain denied');
  await frame.locator('a[href="/test.md"]').click();
  await wait(()=>vscode.window.activeTextEditor?.document.uri.toString() === vscode.Uri.file(path.join(workspace,'test.md')).toString(),'Workspace-root reference remains safe despite untrusted referenceRoot');
  checks.push('Workspace documentation reference navigation remains available');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
  frame=await findFrame('input[aria-label="Filter documentation"]');
  await frame.locator('input[aria-label="Filter documentation"]').fill('trust-proof.md');
  await frame.locator('button.documentation-file[title="trust-proof.md"]').click();
  frame=await findFrame('#rmp-ui-content img[alt="Safe local"]');
  await frame.waitForFunction(()=>document.querySelector('img[alt="Safe local"]')?.naturalWidth === 29);
  assert.equal(requests.length,0);
  checks.push('Documentation Home reads and renders safe workspace Markdown in Restricted Mode');
  if(mode==='transition'){
    await grantFixtureTrust();
    await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
    frame=await findFrame('[data-external-image-action="grant"]');
    assert.equal(await frame.locator('[data-external-image-action="grant"]').count(),1);
    assert.equal(await frame.evaluate(origin=>document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes(origin),remoteOrigin),false);
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(requests.length,0,'Granting workspace trust must not issue any remote request');
    checks.push('Real trust transition enables exactly one grant control without changing CSP or requesting the remote image');
    await frame.locator('[data-external-image-action="grant"]').click();
    let confirmation;
    await wait(async()=>{
      for(const context of browser.contexts()) for(const page of context.pages()) {
        const button=page.getByRole('button',{name:'Allow images',exact:true});
        if(await button.count()===1) { confirmation=button; return true; }
      }
      return false;
    },'Explicit native image-origin confirmation');
    await confirmation.click();
    frame=await findFrame('#rmp-ui-content img[alt="Remote beacon"]');
    await frame.waitForFunction(()=>document.querySelector('img[alt="Remote beacon"]')?.naturalWidth === 29);
    assert.equal(requests.length,1,'One explicit grant issues one intercepted image request in the sole preview');
    assert.equal(await frame.locator('[data-external-image-action="revoke"]').count(),1);
    checks.push('Explicit native origin consent after trust starts exactly one intercepted request and exposes one revoke control');
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview',outside);
    await findFrame('#rmp-ui-content h1');
    assert.ok(previews().some(tab=>tab.label === 'Rich Markdown Preview: outside.md'));
    checks.push('Registered outside-workspace command becomes available after native fixture trust');
  }
};
