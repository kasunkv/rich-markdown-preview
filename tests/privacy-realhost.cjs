const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.proveExternalImages = async ({ vscode, browser, workspace, findFrame, checks }) => {
  const origin = 'https://privacy-proof.example';
  const requests = [];
  for (const context of browser.contexts()) {
    await context.route('https://*.example/**', async route => {
      if (!route.request().url().includes('privacy-proof')) return route.abort('blockedbyclient');
      requests.push({ url: route.request().url(), headers: route.request().headers() });
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="11"/>' });
    });
  }
  await fs.mkdir(path.join(workspace, '.vscode'), {recursive: true});
  await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
    'richMarkdownPreview.externalImageOrigins.v1': [origin], 'richMarkdownPreview.allowRemoteImages': true,
  }));
  const target = vscode.Uri.file(path.join(workspace, 'privacy-proof.md'));
  await fs.writeFile(target.fsPath, `# Image privacy proof\n\n![Private](${origin}/image.svg)`);
  const second = vscode.Uri.file(path.join(workspace, 'privacy-second.md'));
  await fs.writeFile(second.fsPath, `# Second image privacy proof\n\n![Private second](${origin}/second.svg)`);
  const confirm = async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        const button = page.getByRole('button', {name: 'Allow images', exact: true});
        if (await button.count()) { await button.click(); return; }
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
      const home = await findFrame('input[aria-label="Filter documentation"]');
      await home.locator('input[aria-label="Filter documentation"]').fill('privacy-proof.md');
      await home.locator('button.documentation-file[title="privacy-proof.md"]').click();
    }
    let frame = await findFrame('[data-external-image-action="grant"]');
    const start = requests.length;
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    // A forged origin keeps the genuine current render/request token but fails the host allowlist.
    await frame.locator('[data-external-image-action="grant"]').first().evaluate(button => {
      button.dataset.externalImageOrigin = 'https://forged-privacy-proof.example'; button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(requests.length, start);
    await frame.locator('[data-external-image-action="grant"]').first().evaluate((button, origin) => {
      button.dataset.externalImageOrigin = origin; button.click();
    }, origin);
    await confirm();
    frame = await findFrame('img[alt="Private"]');
    await frame.waitForFunction(() => document.querySelector('img[alt="Private"]')?.naturalWidth === 23);
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
    frame = await findFrame('img[alt="Private second"]');
    await frame.waitForFunction(() => document.querySelector('img[alt="Private second"]')?.naturalWidth === 23);
    assert.ok(requests.some(request => request.url === origin + '/second.svg'));
    const afterGrant = requests.length;
    await frame.locator('[data-external-image-action="revoke"]').first().click();
    frame = await findFrame('[data-external-image-action="grant"]');
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(requests.length, afterGrant);
    if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
    else await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
    frame = await findFrame('#rmp-heading-image-privacy-proof');
    await frame.locator('[data-external-image-action="grant"]').waitFor();
    assert.equal(await frame.locator('#rmp-ui-content img').count(), 0);
    assert.equal(requests.length, afterGrant);
    checks.push({mode, multipleDocuments: true, remoteImagePrivacy: { blockedRequests: 0, grantedOrigin: origin, noReferrer: true, forgedOriginDenied: true, exactCsp: true, revoked: true, workspaceSettingBypassDenied: true }});
  }
};
