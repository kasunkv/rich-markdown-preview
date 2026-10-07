// End-to-end checks of the shipped webview bundle in Chromium.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../dist/render.cjs');
const manifest = require('../package.json');

(async () => {
  const server = spawn(process.execPath, ['tests/preview-server.cjs'], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'inherit'] });
  let browser;
  const checks = [], errors = [];
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Preview server exited: ${code}`))); });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {}) });
    const context = await browser.newContext({ viewport:{width:1440,height:1000}, permissions:['clipboard-read','clipboard-write'] });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4173');
    await page.locator('.mermaid-result').first().waitFor();
    assert.equal(await page.locator('.brand').innerText(), 'Markdown Lens\nPREVIEW');
    assert.equal(await page.locator('#style option').count(), 18);
    assert.equal(await page.locator('.brand-icon').evaluate(img => img.complete && img.naturalWidth > 0), true);
    checks.push('Brand, icon, eighteen styles, and real Mermaid rendering');

    const preferences = {style:'ocean',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
    const render = async source => {
      const result = renderMarkdown(source);
      await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences});
    };
    for (const appearance of ['light','dark']) {
      for (const style of manifest.contributes.configuration.properties['styledMarkdown.style'].enum) {
        await page.selectOption('#style', style); await page.selectOption('#appearance', appearance);
        await page.waitForFunction(({style,appearance}) => document.body.dataset.style===style && document.body.dataset.appearance===appearance, {style,appearance});
        assert.ok(await page.locator('#content').evaluate(el => getComputedStyle(el).color !== getComputedStyle(document.body).backgroundColor));
      }
    }
    checks.push('All 36 style/appearance combinations');
    await page.selectOption('#style','editorial'); await page.selectOption('#appearance','light');
    fs.mkdirSync('docs',{recursive:true}); await page.screenshot({path:'docs/markdown-lens-light.png'});
    await page.selectOption('#style','ocean'); await page.selectOption('#appearance','dark');
    await page.screenshot({path:'docs/markdown-lens-dark.png'});

    await render('| Name | Value |\n| --- | ---: |\n| Item 10 | 10 |\n| Item 2 | 2 |\n| Item 1 | |\n\n| Other |\n| --- |\n| Separate |');
    const table = page.locator('.table-panel').first();
    await table.locator('.table-sort').nth(1).click();
    assert.deepEqual(await table.locator('tbody tr td:first-child').allTextContents(), ['Item 2','Item 10','Item 1']);
    await table.locator('.table-sort').nth(1).click();
    assert.deepEqual(await table.locator('tbody tr td:first-child').allTextContents(), ['Item 10','Item 2','Item 1']);
    await table.locator('.table-search').fill('ITEM 2');
    assert.equal(await table.locator('tbody tr:visible').count(), 1);
    assert.equal(await page.locator('.table-panel').nth(1).locator('tbody tr:visible').count(), 1);
    await table.locator('.table-copy').click();
    await page.waitForFunction(() => document.getElementById('announcement').textContent === 'Table CSV copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '"Name","Value"\r\n"Item 2","2"\r\n');
    const downloadPromise = page.waitForEvent('download'); await table.locator('.table-export').click();
    const download = await downloadPromise; assert.equal(download.suggestedFilename(),'table-1.csv');
    const stream = await download.createReadStream(); const chunks=[]; for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString('utf8'), '\uFEFF"Name","Value"\r\n"Item 2","2"\r\n');
    await table.locator('.table-density').selectOption('compact');
    await render('| Name | Value |\n| --- | ---: |\n| Item 2 | 2 |\n| Item 3 | 3 |');
    assert.equal(await table.locator('.table-search').inputValue(),'ITEM 2');
    assert.equal(await table.getAttribute('data-density'),'compact');
    await table.locator('.table-search').fill('missing'); assert.equal(await table.locator('.table-empty').isVisible(),true);
    await table.locator('.table-reset').click(); assert.equal(await table.locator('tbody tr:visible').count(),2);
    checks.push('Table sort, filter, independent tables, reset, density, state retention, clipboard, CSV download and BOM');

    await render('# Heading\n\n```typescript\nconst value = 42;\n```\n\n```mermaid\nflowchart LR\n A --> B\n```');
    await page.locator('.mermaid-result').waitFor();
    await page.locator('.copy-code').click();
    await page.waitForFunction(() => document.getElementById('announcement').textContent === 'Code copied');
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n','\n'),'const value = 42;\n');
    await page.check('#wrapCode'); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('wrap-code')),true);
    await page.click('#toggle-outline'); assert.equal(await page.locator('.outline').isVisible(),false);
    await page.click('#toggle-outline'); assert.equal(await page.locator('#toggle-outline').getAttribute('aria-expanded'),'true');
    await page.selectOption('#appearance','auto');
    const before = await page.locator('.mermaid-result svg').getAttribute('id');
    await page.evaluate(() => document.body.classList.add('vscode-dark'));
    await page.waitForFunction(before => document.querySelector('.mermaid-result svg')?.id !== before, before);
    checks.push('Code copy, wrap, outline, and Mermaid refresh on automatic theme changes');
    await render('```mermaid\ninvalid diagram syntax\n```'); await page.locator('.diagram-error').waitFor();
    assert.match(await page.locator('.mermaid-source').innerText(), /invalid diagram syntax/);
    await render(''); assert.equal(await page.locator('.empty').isVisible(),true);
    await page.setViewportSize({width:520,height:800});
    assert.equal(await page.locator('#toggle-outline').isVisible(),true);
    checks.push('Invalid diagram recovery, empty preview, and narrow viewport controls');
    assert.deepEqual(errors, []);
    fs.mkdirSync('.test-results',{recursive:true}); fs.writeFileSync('.test-results/browser.json',JSON.stringify({passed:true,checks},null,2));
    console.log(checks.map(check => `PASS ${check}`).join('\n'));
  } finally { await browser?.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode=1; });
