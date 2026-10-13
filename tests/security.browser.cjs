const { test: base } = require('./browser-fixtures.cjs');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('../dist/render.cjs');
const { startSecurityServer } = require('./security-server.cjs');
// Override the ordinary QA fixture: fulfill every candidate remote request safely and count it.
const test = base.extend({ consoleEvidence: [async ({ page }, use, testInfo) => {
  const requests = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '../assets/rich-markdown-preview.png')) });
  });
  page.securityRequests = requests;
  try { await use(); } finally {
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
async function render(page, source) {
  const result = renderMarkdown(source);
  await page.evaluate(message => dispatchEvent(new MessageEvent('message', { data: message })), { type: 'render', renderId: 'security_1', ...result, preferences });
}
const corpus = [
  ['raw HTML', '<script>attack()</script>\n<img src="https://blocked.test/raw" onerror="attack()">\n<iframe src="https://blocked.test/frame"></iframe>'],
  ['frontmatter aliases', '---\nx: &x "<img src=https://blocked.test/yaml onerror=attack()>"\ny: [*x, *x]\ncycle: &cycle [*cycle]\n---\n# Safe'],
  ['executable links', '[execute](javascript:attack())\n[encoded](jav&#x61;script:attack())\n[script data](data:text/html;base64,PHNjcmlwdD5hdHRhY2soKTwvc2NyaXB0Pg==)'],
  ['remote images', '![unexpected](https://blocked.test/image.png)\n![protocol relative](//blocked.test/relative.png)'],
  ['Mermaid label', '```mermaid\nflowchart TD\nA["<img src=https://blocked.test/diagram onerror=attack()>"] --> B[Safe]\n```'],
  ['Mermaid directive', '```mermaid\n%%{init: {"securityLevel":"loose", "startOnLoad":true}}%%\nflowchart TD\nA[Safe] --> B[Safe]\nclick A "javascript:attack()"\n```'],
  ['Mermaid frontmatter config', '```mermaid\n---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\nA[Safe] --> B[Safe]\nclick A "https://blocked.test/click"\n```'],
];
for (const [name, source] of corpus) test(`exact production CSP: ${name}`, async ({ page }) => {
  const server = await boot(page);
  try {
    await render(page, source + '\n\n# Corpus end');
    await expect(page.locator('#rmp-ui-content')).toContainText('Corpus end');
    if (source.includes('```mermaid')) await expect(page.locator('.mermaid-result, .diagram-error')).toHaveCount(1);
    expect(await page.evaluate(() => window.attackExecuted)).toBe(false);
    expect(page.securityRequests).toEqual([]);
    expect(await page.locator('#rmp-ui-content script, #rmp-ui-content iframe, #rmp-ui-content [onerror], #rmp-ui-content a[href^="javascript:"]').count()).toBe(0);
  } finally { await server.close(); }
});
test('exact production CSP permits Markdown, diagrams, local and explicitly approved remote images', async ({ page }) => {
  const server = await boot(page, ['https://approved.test']);
  try {
    await render(page, `# Permitted\n\n![local](${server.url}/local.png)\n![approved](https://approved.test/image.png)\n\n\`\`\`mermaid\nflowchart TD\nA[Allowed] --> B[Diagram]\n\`\`\``);
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
