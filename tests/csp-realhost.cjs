// Proves the shipped shell in Electron's real VS Code webview, alongside resource authorization.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { attackCorpus } = require('./security-corpus.cjs');
exports.proveProductionCsp = async ({ vscode, browser, workspace, findFrame, checks }) => {
  const requests = [];
  for (const context of browser.contexts()) {
    await context.addInitScript(() => {
      window.attackExecuted = false;
      window.attack = () => { window.attackExecuted = true; };
      window.policyViolations = [];
      addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.effectiveDirective));
    });
    await context.route('https://*.csp-proof.example/**', route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9"/>' });
    });
  }
  const corpus = attackCorpus.filter(([name]) => name !== 'frontmatter aliases').map(([name, source]) => `## ${name}\n\n${source}`).join('\n\n');
  const frontmatter = attackCorpus.find(([name]) => name === 'frontmatter aliases')[1];
  const source = (frontmatter + '\n\n# Production CSP proof\n\n' + corpus).replaceAll('blocked.test', 'blocked.csp-proof.example');
  const target = vscode.Uri.file(path.join(workspace, 'production-csp-proof.md'));
  await fs.writeFile(target.fsPath, source);
  for (const mode of ['single-file', 'documentation-home']) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
    else {
      await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
      const home = await findFrame('input[aria-label="Filter documentation"]');
      await home.locator('input[aria-label="Filter documentation"]').fill('production-csp-proof.md');
      await home.locator('button.documentation-file[title="production-csp-proof.md"]').click();
    }
    const frame = await findFrame('#rmp-heading-production-csp-proof');
    await frame.waitForFunction(() => document.querySelectorAll('.mermaid-result, .diagram-error').length === 3);
    const policy = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    for (const directive of ['default-src', 'connect-src', 'frame-src', 'object-src', 'base-uri', 'form-action']) assert.ok(policy.includes(`${directive} 'none'`));
    assert.match(policy, /script-src 'nonce-[a-f\d]{32}'/);
    assert.doesNotMatch(policy, /unsafe-eval|img-src[^;]*\shttps:\s/);
    assert.equal(await frame.locator('html').getAttribute('lang'), 'en');
    assert.equal(await frame.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    assert.equal(await frame.locator('#rmp-ui-content script, #rmp-ui-content iframe, #rmp-ui-content [onerror], .diagram a[href]').count(), 0);
    assert.equal(await frame.evaluate(() => window.attackExecuted), false);
    await frame.evaluate(() => {
      const script = document.createElement('script'); script.textContent = 'attack()'; document.body.append(script);
      const image = document.createElement('img'); image.setAttribute('onerror', 'attack()'); image.src = 'https://blocked.csp-proof.example/probe'; document.body.append(image); image.dispatchEvent(new Event('error'));
      fetch('https://blocked.csp-proof.example/fetch').catch(() => {});
    });
    await frame.waitForFunction(() => window.policyViolations.length >= 3);
    assert.equal(await frame.evaluate(() => window.attackExecuted), false);
    assert.deepEqual(requests, [], 'No disallowed request reaches the safely fulfilled candidate route');
    checks.push({mode,productionCsp:{attackCorpus:attackCorpus.map(([name])=>name),attackerExecution:false,disallowedNetworkRequests:0,scriptNonce:true,strictMermaid:true,inlineStylesForDiagrams:true}});
  }
};
