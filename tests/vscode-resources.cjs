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
                if (await frame.locator(selector).count()) return frame;
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
        const frame = await findFrame('input[aria-label="Filter documentation"]');
        await frame.locator('input[aria-label="Filter documentation"]').fill('guide.md');
        await frame.locator('button.documentation-file[title="docs/guide.md"]').click();
      }
      const frame = await findFrame('#rmp-ui-content img[alt="Sibling authorized"]');
      await frame.waitForFunction(() => document.querySelector('img[alt="Sibling authorized"]')?.naturalWidth > 0);
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
