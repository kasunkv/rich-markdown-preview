const { test: base } = require('./browser-fixtures.cjs');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('../dist/render.cjs');
const { startSecurityServer } = require('./security-server.cjs');
// Override the ordinary QA fixture: fulfill every candidate remote request safely and count it.
const test = base.extend({ consoleEvidence: [async ({ page }, use, testInfo) => {
  const requests = [], consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.type() + ': ' + message.text()));
  page.on('pageerror', error => consoleMessages.push('pageerror: ' + error.stack));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '../assets/rich-markdown-preview.png')) });
  });
  page.securityRequests = requests;
  try { await use(); } finally {
    await testInfo.attach('browser-console', { body: consoleMessages.join('\n'), contentType: 'text/plain' });
    await testInfo.attach('candidate-network-requests', { body: JSON.stringify(requests), contentType: 'application/json' });
  }
}, { auto: true }] });
const preferences = { style: 'documentation', appearance: 'light', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false };
async function boot(page, origins = []) {
  const server = await startSecurityServer({ imageOrigins: origins });
  await page.addInitScript(() => {
    window.hostMessages = [];
    window.attackExecuted = false;
    window.attack = () => { window.attackExecuted = true; };
    window.acquireVsCodeApi = () => ({ getState: () => undefined, setState: () => {}, postMessage: message => window.hostMessages.push(message) });
    window.policyViolations = [];
    addEventListener('securitypolicyviolation', event => window.policyViolations.push({ directive: event.effectiveDirective, uri: event.blockedURI }));
  });
  await page.goto(server.url);
  await expect(page.locator('#rmp-ui-content')).toBeAttached();
  return server;
}
async function render(page, source, origins = []) {
  const result = renderMarkdown(source, src => src, { grants: new Set(origins), enabled: true });
  await page.evaluate(message => dispatchEvent(new MessageEvent('message', { data: message })), { type: 'render', renderId: 'security_1', ...result, preferences });
}
const { attackCorpus: corpus } = require('./security-corpus.cjs');
for (const [name, source] of corpus) test(`exact production CSP: ${name}`, async ({ page }) => {
  const server = await boot(page);
  try {
    await render(page, source + '\n\n# Corpus end');
    await expect(page.locator('#rmp-ui-content')).toContainText('Corpus end');
    if (source.includes('```mermaid')) {
      await expect(page.locator('.mermaid-result, .diagram-error')).toHaveCount(1);
      expect(await page.locator('.diagram a[href]').count()).toBe(0);
    }
    expect(await page.evaluate(() => window.attackExecuted)).toBe(false);
    expect(page.securityRequests).toEqual([]);
    expect(await page.locator('#rmp-ui-content script, #rmp-ui-content iframe, #rmp-ui-content [onerror], #rmp-ui-content a[href^="javascript:"]').count()).toBe(0);
  } finally { await server.close(); }
});
test('exact production CSP permits Markdown, diagrams, local and explicitly approved remote images', async ({ page }) => {
  const server = await boot(page, ['https://approved.test']);
  try {
    await render(page, `# Permitted\n\n![local](/local.png)\n![approved](https://approved.test/image.png)\n\n\`\`\`mermaid\nflowchart TD\nA[Allowed] --> B[Diagram]\n\`\`\``, ['https://approved.test']);
    await expect(page.locator('.mermaid-result svg')).toHaveCount(1);
    for (const alt of ['local', 'approved']) await expect.poll(() => page.locator(`img[alt="${alt}"]`).evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(page.securityRequests).toEqual(['https://approved.test/image.png']);
  } finally { await server.close(); }
});
test('exact production CSP independently blocks script, handlers and connections', async ({ page }) => {
  const server = await boot(page);
  try {
    await page.evaluate(() => {
      const script = document.createElement('script'); script.textContent = 'attack()'; document.body.append(script);
      const image = document.createElement('img'); image.setAttribute('onerror', 'attack()'); image.src = 'https://blocked.test/probe'; document.body.append(image); image.dispatchEvent(new Event('error'));
      fetch('https://blocked.test/fetch').catch(() => {});
    });
    await expect.poll(() => page.evaluate(() => window.policyViolations.length)).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => window.attackExecuted)).toBe(false);
    expect(page.securityRequests).toEqual([]);
  } finally { await server.close(); }
});
test('supported diagram and source limit failures remain responsive under production CSP', async ({ page }) => {
  const server = await boot(page);
  try {
    await render(page, '```mermaid\n' + 'A'.repeat(20_001) + '\n```');
    await expect(page.locator('.diagram-error')).toContainText('20,000');
    await render(page, 'x'.repeat(2_000_001));
    await expect(page.locator('#rmp-ui-content [role="alert"]')).toContainText('2,000,000');
    await render(page, '# Recovered');
    await expect(page.locator('#rmp-ui-content h1')).toHaveText('Recovered');
    expect(page.securityRequests).toEqual([]);
  } finally { await server.close(); }
});

test('exact image grant excludes sibling origins, ports and connection requests', async ({ page }) => {
  const server = await boot(page, ['https://approved.test']);
  try {
    await page.evaluate(() => {
      for (const src of ['https://unapproved.test/pixel', 'https://sub.approved.test/pixel', 'https://approved.test:444/pixel']) {
        const image = document.createElement('img'); image.src = src; document.body.append(image);
      }
      fetch('https://approved.test/connection').catch(() => {});
    });
    await expect.poll(() => page.evaluate(() => window.policyViolations.length)).toBeGreaterThanOrEqual(4);
    expect(page.securityRequests).toEqual([]);
  } finally { await server.close(); }
});
test('Mermaid edge ceiling cannot be enlarged by document directives', async ({ page }) => {
  const server = await boot(page);
  try {
    const edges = Array.from({ length: 501 }, (_, index) => `A${index} --> A${index + 1}`).join('\n');
    await render(page, '```mermaid\n%%{init: {"maxEdges":10000}}%%\nflowchart TD\n' + edges + '\n```');
    await expect(page.locator('.diagram-error')).toHaveCount(1);
    await render(page, '# Edge limit recovery');
    await expect(page.locator('h1')).toHaveText('Edge limit recovery');
    expect(page.securityRequests).toEqual([]);
  } finally { await server.close(); }
});
test('expanded model fallback is actually received and clears stale outline before recovery', async ({ page }) => {
  const server = await boot(page);
  try {
    await render(page, '# Previous content');
    await expect(page.locator('#rmp-ui-outline a')).toHaveCount(1);
    await render(page, '### x\n'.repeat(100001));
    await expect(page.locator('#rmp-ui-content [role="alert"]')).toContainText('rendered content');
    await expect(page.locator('#rmp-ui-outline a')).toHaveCount(0);
    await render(page, '# After output limit');
    await expect(page.locator('#rmp-ui-content h1')).toHaveText('After output limit');
    expect(page.securityRequests).toEqual([]);
  } finally { await server.close(); }
});
test('valid Mermaid image metadata interprets encoded hosts while exact approved origin remains required', async ({ page }) => {
  const server=await boot(page,['https://approved.test']);
  try {
    for(const escape of ['%61','%41',String.fromCharCode(92)+'u0061',String.fromCharCode(92)+'U00000061',String.fromCharCode(0xff41),'a'+String.fromCharCode(0xad)]) {
      const source='```mermaid\nflowchart TD\nA@{img: "https://'+escape+'pproved.test/diagram.png",label: "Valid escaped image",h: 20} --> B[Safe]\n```';
      await render(page,source);await expect(page.locator('.mermaid-result .image-shape')).toHaveCount(1);
      expect(page.securityRequests.every(url=>url==='https://approved.test/diagram.png')).toBe(true);
    }
    expect(page.securityRequests.length).toBeGreaterThan(0);
  }finally{await server.close();}
});
test('IPv6 origin limitation is visible and unsupported grant messages have no effect', async ({ page }) => {
  const server=await boot(page);
  try {
    await render(page,'![IPv6](https://[::1]/pixel.svg)');
    await expect(page.locator('#rmp-ui-content')).toContainText('IPv6 image hosts are unsupported');
    await expect(page.locator('.external-image-action')).toHaveCount(0);
    expect(page.securityRequests).toEqual([]);
  }finally{await server.close();}
});


test('accessible diagram, privacy and documentation keyboard flows use exact production shell', async ({page}) => {
  const server=await boot(page,['https://approved.test']);
  const source='---\ntitle: Accessible reading\n---\n# Reading\n\n![Private](https://approved.test/image.png)\n\n```mermaid\nflowchart TD\naccTitle: Reading workflow\naccDescr: A reader opens the source alternative.\nReader-->Source\n```\n\n| Name | Count |\n|---|---|\n| Alpha | 1 |\n| Beta | 2 |';
  try {
    await render(page,source);
    await expect(page.locator('.mermaid-result svg')).toHaveCount(1);
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    await expect(page.locator('.mermaid-result svg title')).toHaveText('Reading workflow');
    await expect(page.locator('.mermaid-result svg desc')).toHaveText('A reader opens the source alternative.');
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
    for(const theme of ['vscode-high-contrast','vscode-high-contrast-light']) {
      await page.evaluate(theme=>document.body.className=theme,theme);
      for(const width of [640,320]) {
        await page.setViewportSize({width,height:900});
        const grant=page.locator('[data-external-image-action="grant"]').first();
        await grant.focus(); await page.keyboard.press('Enter');
        expect(await page.evaluate(()=>window.hostMessages.at(-1).type)).toBe('grantExternalImageOrigin');
        await render(page,source,['https://approved.test']);
        const revoke=page.locator('[data-external-image-action="revoke"]').first();
        await revoke.focus(); await page.keyboard.press('Enter');
        expect(await page.evaluate(()=>window.hostMessages.at(-1).type)).toBe('revokeExternalImageOrigin');
        await render(page,source);
        await expect(page.locator('.mermaid-result svg')).toHaveCount(1);
        const summary=page.locator('.diagram-source summary');
        await summary.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
        expect(await page.evaluate(()=>document.activeElement.className)).toBe('mermaid-source');
        await summary.focus(); await page.keyboard.press('Enter');
        const reset=page.locator('.table-reset').first();
        if(await reset.isEnabled()){await reset.focus();await page.keyboard.press('Enter');}
        await page.locator('.table-sort').first().focus(); await page.keyboard.press('Enter');
        await expect(page.locator('th').first()).toHaveAttribute('aria-sort','ascending');
        const scan=await page.evaluate(async()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
        expect(scan.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      }
    }
    const file={id:'file:///fixture/reading.md',root:'file:///fixture',rootName:'Fixture',path:'reading.md'};
    await page.evaluate(file=>dispatchEvent(new MessageEvent('message',{data:{type:'documentation',files:[file],active:file.id,loading:false,canBack:false,canForward:false}})),file);
    await page.evaluate(model=>dispatchEvent(new MessageEvent('message',{data:{type:'render',renderId:'accessibility_doc',...model,preferences:{style:'documentation',appearance:'auto',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false},documentationHome:true,documentId:'file:///fixture/reading.md'}})),renderMarkdown(source));
    const filter=page.getByRole('searchbox',{name:'Filter documentation files or folders'});
    await filter.fill('reading.md');
    const entry=page.getByRole('button',{name:'reading.md',exact:true});
    await entry.focus(); await page.keyboard.press('Enter');
    expect(await page.evaluate(()=>window.hostMessages.at(-1))).toMatchObject({type:'documentationAction',action:'open',id:file.id});
    await page.getByRole('button',{name:'On this page',exact:true}).focus(); await page.keyboard.press('Enter');
    const heading=page.locator('#rmp-ui-outline a').first();
    await heading.focus(); await page.keyboard.press('Enter');
    expect(await page.evaluate(()=>document.activeElement.id)).toBe('rmp-heading-reading');
    const scan=await page.evaluate(async()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
    expect(scan.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
    expect(await page.evaluate(()=>window.policyViolations.filter(v=>v.directive!=='img-src'))).toEqual([]);
  } finally {await server.close();}
});
