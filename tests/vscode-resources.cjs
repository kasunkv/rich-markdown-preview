const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.proveResources = async function ({ workspace, checks }) {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await fs.mkdir(path.join(workspace, 'docs'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(workspace, 'assets', 'diagram.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="37" height="19"><rect width="37" height="19" fill="green"/></svg>',
  );
  await fs.writeFile(
    path.join(path.dirname(workspace), 'secret.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="41" height="21"/>',
  );
  const guide = vscode.Uri.file(path.join(workspace, 'docs', 'guide.md'));
  await fs.writeFile(
    guide.fsPath,
    '# Resource proof\n\n![Sibling authorized](../assets/diagram.svg?v=1#view)\n\n![Outside denied](../../secret.svg)',
  );
  const browser = await require('playwright').chromium.connectOverCDP(
    'http://127.0.0.1:' + process.env.RICH_MARKDOWN_PREVIEW_DEBUG_PORT,
  );
  try {
    const outOfRootResponses = [];
    for (const context of browser.contexts())
      for (const page of context.pages())
        page.on('response', (response) => {
          if (response.url().includes('secret.svg') && response.ok()) outOfRootResponses.push(response.url());
        });
    const findFrame = async (selector) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        for (const context of browser.contexts())
          for (const page of context.pages())
            for (const frame of page.frames()) {
              try {
                if (!(await frame.locator(selector).count()) || !(await frame.locator('#rmp-ui-app').isVisible())) continue;
                let owner=frame, visible=true;
                while(owner.parentFrame()) {
                  const element=await owner.frameElement();
                  try {
                    if(!(await element.isVisible()) || await element.evaluate(el=>Boolean(el.closest('[aria-hidden="true"]')))) {visible=false;break;}
                  } finally {await element.dispose();}
                  owner=owner.parentFrame();
                }
                if(visible) return frame;
              } catch {}
            }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Real webview frame unavailable: ' + selector);
    };
    for (const mode of ['single-file', 'documentation-home']) {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', guide);
      else {
        await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
        const frame = await findFrame('input[aria-label="Filter documentation files or folders"]');
        await frame.locator('input[aria-label="Filter documentation files or folders"]').fill('guide.md');
        await frame.locator('button.documentation-file[title="docs/guide.md"]').click();
      }
      const frame = await findFrame('#rmp-ui-content img[alt="Sibling authorized"]');
      try { await frame.waitForFunction(() => document.querySelector('img[alt="Sibling authorized"]')?.naturalWidth > 0); }
      catch (error) { await fs.writeFile(path.join(workspace,'resource-policy-diagnostic.json'), JSON.stringify(await frame.evaluate(() => ({ policy:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, image:document.querySelector('img[alt="Sibling authorized"]').src, widths:Array.from(document.images).map(img=>[img.src,img.naturalWidth]) })),null,2)); throw error; }
      const evidence = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('#rmp-ui-content img')).map((img) => ({
          alt: img.alt,
          src: img.getAttribute('src'),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        })),
      );
      checks.push({ mode, realWebviewImages: evidence });
      const loaded = evidence.find((img) => img.alt === 'Sibling authorized');
      const denied = evidence.find((img) => img.alt === 'Outside denied');
      assert.equal(loaded.naturalWidth, 37);
      assert.equal(loaded.complete, true);
      assert.ok(loaded.src.includes('/assets/diagram.svg') && loaded.src.includes('v=1'));
      assert.equal(denied.src, '');
      assert.equal(denied.naturalWidth, 0);
      assert.equal(outOfRootResponses.length, 0, 'No successful outside-root request');
    }
    await require('./find-host.cjs').proveFind({ vscode, findFrame, workspace, checks });
    // Harmless fixture-only raw resource probe bypasses the Markdown image resolver.
    const outside = path.join(path.dirname(workspace),'raw-alias-outside');
    const alias = path.join(workspace,'assets','raw-alias');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside,'outside.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="47" height="23"/>');
    await fs.symlink(outside,alias,process.platform==='win32'?'junction':'dir');
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview',guide);
    let aliasFrame = await findFrame('img[alt="Sibling authorized"]');
    const raw = new URL(await aliasFrame.locator('img[alt="Sibling authorized"]').getAttribute('src'));
    raw.pathname=raw.pathname.replace('/assets/diagram.svg','/assets/raw-alias/outside.svg');raw.search='';raw.hash='';
    const aliasRequests=[];for(const context of browser.contexts())for(const page of context.pages())page.on('request',request=>{if(request.url().includes('/assets/raw-alias/outside.svg'))aliasRequests.push(request.url());});
    const aliasDoc = vscode.Uri.file(path.join(workspace,'raw-alias-proof.md'));
    const wide=Array.from('vscode',character=>String.fromCharCode(character.charCodeAt(0)+0xfee0)).join('');
    const rawValues=[raw.href.replace('https://','https:/').replace('vscode-resource',wide+'-resource'),raw.href.replace('https://','https:').replace('vscode-resource',wide+'-resource'),raw.href.replace('vscode-resource',wide+'-resource'),raw.href.replace('vscode-resource.vscode-cdn','vscode-resource'+String.fromCharCode(0x3002)+'vscode-cdn'),raw.href.replace('vscode-resource','vs'+String.fromCharCode(0xad)+'code-resource'),raw.href,raw.href.replace('vscode-resource','%76scode-resource'),raw.href.replace('vscode-resource',String.fromCharCode(92)+'u0076scode-resource'),raw.href.replace('vscode-resource',String.fromCharCode(92)+'U00000076scode-resource')];
    await fs.writeFile(aliasDoc.fsPath,'# Raw alias boundary\n\n![Resolver denied](assets/raw-alias/outside.svg)\n\n'+rawValues.map(value=>'```mermaid\nflowchart TD\nA@{img: "'+value+'",label: "Raw alias boundary",h: 20} --> B[Valid image graph]\n```').join('\n\n'));
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview',aliasDoc);
    aliasFrame=await findFrame('#rmp-heading-raw-alias-boundary');
    await aliasFrame.waitForFunction(()=>document.querySelectorAll('.mermaid-result,.diagram-error').length===9);
    const aliasEvidence=await aliasFrame.evaluate(()=>({resolverSource:document.querySelector('img[alt="Resolver denied"]').getAttribute('src'),renderedRawImage:document.querySelectorAll('.mermaid-result .image-shape').length,blockedForms:document.querySelectorAll('.diagram-error').length,diagramError:document.querySelector('.diagram-error')?.textContent}));
    await fs.writeFile(path.join(workspace,'raw-alias-boundary.json'),JSON.stringify(aliasEvidence,null,2));
    assert.equal(aliasEvidence.resolverSource,'');assert.equal(aliasEvidence.blockedForms,9);
    assert.equal(aliasEvidence.renderedRawImage,0,'Raw Mermaid resource URL must not read the harmless outside-root alias image');
    assert.deepEqual(aliasRequests,[],'No raw alias request occurs before the internal URL rejection');
    checks.push({rawAliasBoundary:{...aliasEvidence,rawRequests:aliasRequests.length}});
    await require('./csp-realhost.cjs').proveProductionCsp({ vscode, browser, workspace, findFrame, checks });
    // Background Electron does not reliably advance smooth-scroll animation.
    // Prove actual viewport movement via spec 014's native auto path; browser tests cover smooth options.
    for (const context of browser.contexts())
      for (const page of context.pages()) await page.emulateMedia({ reducedMotion: 'reduce' });
    if (process.env.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST === '1') await require('./privacy-realhost.cjs').proveExternalImages({ vscode, browser, workspace, findFrame, checks });
    await require('./navigation-host.cjs').proveNavigation({ vscode, workspace, findFrame, checks });
    await require('./accessibility-host.cjs').proveAccessibility({vscode,browser,workspace,findFrame,checks});
  } finally {
    await browser.close();
  }
};
