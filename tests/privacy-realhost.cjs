const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.proveExternalImages = async ({ vscode, browser, workspace, findFrame, checks, caseId = '' }) => {
  const suffix=caseId ? '-'+caseId : '';
  const origin = 'https://privacy-proof'+suffix+'.example';
  const requests = [];
  for (const context of browser.contexts()) {
    await context.route('https://*.example/**', async route => {
      if (!route.request().url().includes('privacy-proof')) return route.abort('blockedbyclient');
      requests.push({ url: route.request().url(), headers: route.request().headers() });
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="11"/>' });
    });
  }
  await fs.mkdir(path.join(workspace, '.vscode'), {recursive: true});
  const ownedSettings=path.join(workspace,'.vscode','settings.json');
  let previousSettings={};
  try {previousSettings=JSON.parse(await fs.readFile(ownedSettings,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
  await fs.writeFile(ownedSettings, JSON.stringify({
    ...previousSettings,
    'richMarkdownPreview.externalImageOrigins.v1': [origin], 'richMarkdownPreview.allowRemoteImages': true,
  }));
  const target = vscode.Uri.file(path.join(workspace, 'privacy-proof'+suffix+'.md'));
  await fs.writeFile(target.fsPath, `# Image privacy proof${caseId ? " "+caseId : ""}\n\n![Private](${origin}/image.svg)\n\n![](${origin}/unmeasured.svg)\n\n\`\`\`mermaid\nflowchart TD\nA@{img: "${origin}/diagram.svg", label: "Approved image graph", h: 20} --> B[Allowed by exact grant]\n\`\`\``);
  const second = vscode.Uri.file(path.join(workspace, 'privacy-second'+suffix+'.md'));
  await fs.writeFile(second.fsPath, `# Second image privacy proof\n\n![Private second](${origin}/second.svg)`);
  const confirm = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        const button = page.getByRole('button', {name: 'Allow images', exact: true});
        if (await button.count()) { await button.focus(); await page.keyboard.press('Enter'); return; }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const diagnostics = [];
    for (const context of browser.contexts()) for (const page of context.pages()) {
      diagnostics.push({url:page.url(),buttons:await page.getByRole('button').allTextContents(),text:await page.locator('body').innerText().catch(() => '')});
    }
    await fs.writeFile(path.join(workspace,'privacy-dialog-diagnostics.json'),JSON.stringify(diagnostics,null,2));
    throw Error('VS Code host-owned external image permission confirmation missing; see privacy-dialog-diagnostics.json');
  };
  for (const mode of ['single-file', 'documentation-home']) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
    else {
      await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
      const home = await findFrame('input[aria-label="Filter documentation files or folders"]');
      await home.locator('input[aria-label="Filter documentation files or folders"]').fill('privacy-proof'+suffix+'.md');
      await home.locator('button.documentation-file[title="privacy-proof'+suffix+'.md"]').click();
    }
    let frame = await findFrame('[data-external-image-action="grant"][data-external-image-origin="'+origin+'"]');
    const start = requests.length;
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    // A forged origin keeps the genuine current render/request token but fails the host allowlist.
    await frame.locator('[data-external-image-action="grant"]').first().evaluate(button => {
      button.dataset.externalImageOrigin = 'https://forged-privacy-proof.example'; button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(requests.length, start);
    await frame.locator('[data-external-image-action="grant"]').first().evaluate((button, origin) => {button.dataset.externalImageOrigin = origin;}, origin);
    await frame.locator('[data-external-image-action="grant"]').first().focus(); await frame.page().keyboard.press('Enter');
    await confirm();
    frame = await findFrame('img[alt="Private"][src^="'+origin+'/"]');
    await frame.page().bringToFront();
    await frame.locator('img[alt="Private"]').scrollIntoViewIfNeeded();
    try {
      await frame.waitForFunction(() => document.querySelector('img[alt="Private"]')?.naturalWidth === 23);
    } catch(error) {
      const state=await frame.evaluate(()=>({image:[...document.querySelectorAll('img')].map(img=>({alt:img.alt,src:img.src,currentSrc:img.currentSrc,naturalWidth:img.naturalWidth,complete:img.complete,loading:img.loading,rect:img.getBoundingClientRect().toJSON()})),violations:window.policyViolations,visibility:document.visibilityState,zoom:devicePixelRatio,viewport:[innerWidth,innerHeight]}));
      await fs.writeFile(path.join(workspace,'privacy-image-diagnostics.json'),JSON.stringify({state,requests},null,2));
      throw error;
    }
    const unmeasured=frame.locator('#rmp-ui-content img[alt=""]');
    await unmeasured.scrollIntoViewIfNeeded();
    await frame.waitForFunction(()=>document.querySelector('#rmp-ui-content img[alt=""]')?.naturalWidth===23);
    assert.equal(await unmeasured.getAttribute('width'),null);assert.equal(await unmeasured.getAttribute('height'),null);
    assert.equal(await unmeasured.getAttribute('loading'),'lazy');
    await frame.locator('.mermaid-result .image-shape').waitFor();
    assert.ok(requests.some(request => request.url === origin + '/diagram.svg'));
    assert.ok(requests.length > start);
    assert.ok(requests.slice(start).every(request => request.url.startsWith(origin + '/') && !request.headers.referer));
    await frame.evaluate(() => {
      const image = document.createElement('img');
      image.src = 'https://ungranted-privacy-proof.example/forged.svg';
      document.querySelector('#rmp-ui-content').append(image);
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(requests.some(request => request.url.includes('ungranted-')), false);
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview', second);
    frame = await findFrame('img[alt="Private second"][src^="'+origin+'/"]');
    await frame.locator('img[alt="Private second"]').scrollIntoViewIfNeeded();
    await frame.waitForFunction(() => document.querySelector('img[alt="Private second"]')?.naturalWidth === 23);
    assert.ok(requests.some(request => request.url === origin + '/second.svg'));
    const afterGrant = requests.length;
    await frame.locator('[data-external-image-action="revoke"]').first().focus(); await frame.page().keyboard.press('Enter');
    frame = await findFrame('[data-external-image-action="grant"][data-external-image-origin="'+origin+'"]');
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(requests.length, afterGrant);
    if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
    else await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
    frame = await findFrame('#rmp-heading-image-privacy-proof'+suffix);
    await frame.locator('[data-external-image-action="grant"]').first().waitFor();
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    assert.equal(requests.length, afterGrant);
    checks.push({mode, multipleDocuments: true, remoteImagePrivacy: { blockedRequests: 0, grantedOrigin: origin, noReferrer: true, forgedOriginDenied: true, exactCsp: true, revoked: true, workspaceSettingBypassDenied: true }});
  }
};


// A separate accessibility proof: consent controls and exact policy at native zoom.
// The full image decode proof above remains mandatory at ordinary native zoom.
exports.proveNativeZoomImageControls = async ({vscode,browser,workspace,findFrame,checks}) => {
  const origin='https://privacy-proof-keyboard.example',requests=[];
  for(const context of browser.contexts())await context.route(origin+'/**',async route=>{
    requests.push({url:route.request().url(),headers:route.request().headers()});
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="23" height="11"/>'});
  });
  const target=vscode.Uri.file(path.join(workspace,'native-zoom-consent.md'));
  await fs.writeFile(target.fsPath,'# Keyboard image consent\n\n![Unmeasured]('+origin+'/image.svg)\n\n```mermaid\nflowchart TD\nA@{img: "'+origin+'/diagram.svg", label: "Consented image", h: 20} --> B[Exact origin]\n```');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openPreview',target);
  let frame=await findFrame('[data-external-image-action="grant"][data-external-image-origin="'+origin+'"]');
  assert.equal(requests.length,0,'Native zoom grant begins with zero external requests');
  assert.equal(await frame.locator('#rmp-ui-content img').count(),0);
  await frame.locator('[data-external-image-action="grant"]').first().focus();await frame.page().keyboard.press('Enter');
  const deadline=Date.now()+15000;let confirmed=false;
  while(!confirmed && Date.now()<deadline) {
    for(const context of browser.contexts())for(const page of context.pages()) {
      const consent=page.getByRole('button',{name:'Allow images',exact:true});
      if(await consent.count()){await consent.focus();await page.keyboard.press('Enter');confirmed=true;break;}
    }
    if(!confirmed)await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(confirmed,'Host-owned consent is keyboard accessible at native zoom');
  frame=await findFrame('[data-external-image-action="revoke"][data-external-image-origin="'+origin+'"]');
  await frame.locator('.mermaid-result .image-shape').waitFor();
  assert.ok(requests.some(request=>request.url===origin+'/diagram.svg'),'Consented Mermaid image loads under exact native CSP');
  assert.ok(requests.every(request=>request.url.startsWith(origin+'/') && !request.headers.referer));
  const image=frame.locator('img[alt="Unmeasured"]');
  assert.equal(await image.getAttribute('src'),origin+'/image.svg');
  assert.equal(await image.getAttribute('loading'),'lazy','Zoom proof does not alter image loading policy');
  const observation=await image.evaluate(img=>({naturalWidth:img.naturalWidth,currentSrc:img.currentSrc,rect:img.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,visibility:document.visibilityState}));
  const afterGrant=requests.length;
  await frame.locator('[data-external-image-action="revoke"]').first().focus();await frame.page().keyboard.press('Enter');
  frame=await findFrame('[data-external-image-action="grant"][data-external-image-origin="'+origin+'"]');
  assert.equal(await frame.locator('#rmp-ui-content img').count(),0);
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(requests.length,afterGrant,'Native revoke stops further origin requests');
  checks.push({nativeZoomImageControls:{keyboardGrant:true,nativeConsent:true,keyboardRevoke:true,exactOriginMermaidLoaded:true,revokedRequests:0,markdownImageObservation:observation,markdownDecodeAt400:'Not established by this interaction proof; unresolved observed minimum-host validation limitation requires manual retest'}});
};
