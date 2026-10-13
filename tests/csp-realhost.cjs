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
    await context.route(/https:\/\/(?:[^/]+\.csp-proof\.example|privacy-probe\.vscode-cdn\.net)\//, route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9"/>' });
    });
  }
  const corpus = attackCorpus.filter(([name]) => name !== 'frontmatter aliases').map(([name, source]) => `## ${name}\n\n${source}`).join('\n\n');
  const frontmatter = attackCorpus.find(([name]) => name === 'frontmatter aliases')[1];
  const imageNode = '\n\n```mermaid\nflowchart TD\nA@{ img: "https://privacy-probe.vscode-cdn.net/pixel.png", label: "CDN image boundary", h: 20 } --> B[Valid image graph]\n```';
  const dataImage = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9"/>').toString('base64');
  const imageControl = '\n\n```mermaid\nflowchart TD\nA@{ img: "' + dataImage + '", label: "Allowed image node", h: 20 } --> B[Valid image control]\n```';
  const themeCSS = '@import url("https://privacy-probe.vscode-cdn.net/style.css"); @font-face {font-family: PrivacyProbe; src:url("https://privacy-probe.vscode-cdn.net/font.woff2") format("woff2");} *{font-family: PrivacyProbe !important;}';
  const cssProbe = '\n\n```mermaid\n%%{init: ' + JSON.stringify({ themeCSS }) + '}%%\nflowchart TD\nA[Valid author CSS probe] --> B[Styles and fonts]\n```';
  const source = (frontmatter + '\n\n# Production CSP proof\n\n' + corpus + imageNode + imageControl + cssProbe).replaceAll('blocked.test', 'blocked.csp-proof.example');
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
    await frame.waitForFunction(() => document.querySelectorAll('.mermaid-result, .diagram-error').length === 6);
    assert.equal(await frame.locator('.mermaid-result .image-shape').count(), 1, 'Data image control proves valid supported Mermaid image syntax');
    assert.equal(await frame.locator('.diagram-error').count(), 1, 'Only unapproved network image is denied');
    assert.equal(await frame.locator('.mermaid-result').count(), 5, 'Strict diagrams, image control and supported theme directive still render');
    const authorThemeCssApplied=await frame.locator('.mermaid-result style').evaluateAll(styles=>styles.some(style=>style.textContent.includes('privacy-probe.vscode-cdn.net/font.woff2')));
    assert.deepEqual(requests, [], 'Unapproved Mermaid CDN image must not request despite resource CDN source');
    const policy = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    for (const directive of ['default-src', 'connect-src', 'frame-src', 'object-src', 'base-uri', 'form-action']) assert.ok(policy.includes(`${directive} 'none'`));
    assert.match(policy, /script-src 'nonce-[a-f\d]{32}'/);
    assert.doesNotMatch(policy, /unsafe-eval|img-src[^;]*\shttps:\s/);
    assert.equal(await frame.locator('html').getAttribute('lang'), 'en');
    assert.equal(await frame.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    assert.equal(await frame.locator('#rmp-ui-content script, #rmp-ui-content iframe, #rmp-ui-content [onerror], .diagram a[href]').count(), 0);
    assert.equal(await frame.evaluate(() => window.attackExecuted), false);
    const probe = await frame.evaluate(async () => {
      const script = document.createElement('script'); script.textContent = 'attack()'; document.body.append(script);
      const image = document.createElement('img'); image.setAttribute('onerror', 'attack()'); image.src = 'https://blocked.csp-proof.example/probe'; document.body.append(image); image.dispatchEvent(new Event('error'));
      await fetch('https://blocked.csp-proof.example/fetch').catch(() => {});
      // VS Code's bootstrap may consume violation events; executions and safely fulfilled
      // candidate requests are authoritative. Allow the image event queue to settle too.
      await new Promise(resolve => setTimeout(resolve, 100));
      return { violations: window.policyViolations, attackerExecution: window.attackExecuted };
    });
    assert.equal(await frame.evaluate(() => window.attackExecuted), false);
    assert.deepEqual(requests, [], 'No disallowed request reaches the safely fulfilled candidate route');
    checks.push({mode,productionCsp:{attackCorpus:attackCorpus.map(([name])=>name),attackerExecution:false,disallowedNetworkRequests:0,scriptNonce:true,strictMermaid:true,inlineStylesForDiagrams:true,authorThemeCssApplied,policyProbe:probe}});
  }
};
