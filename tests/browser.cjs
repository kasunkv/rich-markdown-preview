// End-to-end checks of the shipped webview bundle in Chromium.
const { test } = require('./browser-fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../dist/render.cjs');
const manifest = require('../package.json');

test('shipped preview regressions', async ({page, previewServer}, testInfo) => {
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(previewServer.url);
    await page.locator('.mermaid-result').first().waitFor();
    assert.equal(await page.locator('.brand').innerText(), 'Rich Markdown\nPREVIEW');
    assert.equal(await page.locator('#style option').count(), 18);
    assert.equal(await page.locator('.brand-icon').evaluate(img => img.complete && img.naturalWidth > 0), true);
    checks.push('Brand, icon, eighteen styles, and real Mermaid rendering');

    const preferences = {style:'ocean',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
    const render = async source => {
      const result = renderMarkdown(source);
      await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences});
    };
    await page.evaluate(() => {
      window.referenceClicks = [];
    });
    await render('{{include: /snippets/guide.md}}\n\nRead @references/guide.md\n\n![[Guide]]\n\n[Related document](guide.md)');
    assert.equal(await page.locator('.file-reference').count(), 4);
    for (let index = 0; index < 4; index++) {
      const link = page.locator('.file-reference').nth(index);
      assert.equal(await link.locator('.reference-icon').count(), 1);
      assert.ok(await link.getAttribute('title'));
      const id = await link.getAttribute('data-reference-id');
      await link.click();
      assert.equal(await page.evaluate(() => window.referenceClicks.at(-1).id), id);
    }
    await page.locator('.file-reference').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.referenceClicks.length), 5);
    await render('`@references/guide.md`\n\n```md\n{{include: /snippets/guide.md}}\n```');
    assert.equal(await page.locator('.file-reference').count(), 0);
    checks.push('Reference relationship icons, tooltips, mouse and keyboard opening, and literal code examples');
    await render('---\nname: example-skill\ndescription: |\n  First line\n  Second line\ntags: [agents, writing]\nsettings:\n  enabled: true\n---\n# Instructions\n\nSkill body.');
    assert.equal(await page.locator('.frontmatter').getAttribute('open'), '');
    assert.equal(await page.locator('.frontmatter-field').first().innerText(), 'name\nexample-skill');
    assert.equal(await page.locator('#outline a').count(), 1);
    await page.locator('.frontmatter-raw > summary').click();
    assert.equal(await page.locator('.frontmatter-source').isVisible(), true);
    await page.locator('.frontmatter > summary').click();
    assert.equal(await page.locator('.frontmatter-content').isVisible(), false);
    await page.locator('.frontmatter > summary').click();
    await page.setViewportSize({width:520,height:800});
    assert.equal(await page.locator('.frontmatter').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.setViewportSize({width:1440,height:1000});
    await render('---\ntitle: [broken\n---\n# Body');
    assert.equal(await page.locator('.frontmatter-source').isVisible(), true);
    checks.push('Frontmatter fields, nested YAML, outline, source disclosure, collapse, narrow layout and invalid YAML fallback');
    await render(fs.readFileSync(path.resolve(__dirname, '../samples/showcase.md'), 'utf8'));
    await page.locator('.mermaid-result').first().waitFor();
    for (const appearance of ['light','dark']) {
      for (const style of manifest.contributes.configuration.properties['richMarkdownPreview.style'].enum) {
        await page.selectOption('#style', style); await page.selectOption('#appearance', appearance);
        await page.waitForFunction(({style,appearance}) => document.body.dataset.style===style && document.body.dataset.appearance===appearance, {style,appearance});
        assert.ok(await page.locator('#content').evaluate(el => getComputedStyle(el).color !== getComputedStyle(document.body).backgroundColor));
      }
    }
    checks.push('All 36 style/appearance combinations');
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
    await testInfo.attach('checks', {body: JSON.stringify(checks), contentType: 'application/json'});
    console.log(checks.map(check => `PASS ${check}`).join('\n'));
});

for (const documentationHome of [false, true]) {
  test(`reading interactions survive refresh (${documentationHome ? 'documentation' : 'single file'})`, async ({page, previewServer}) => {
    await page.goto(previewServer.url);
    await page.locator('.table-search').first().waitFor();
    const preferences = {style:'documentation', appearance:'light', contentWidth:900, fontSize:16, lineHeight:1.7, wrapCode:false};
    const source = '---\ntitle: Reading\n---\n# Inventory\n\n| Name | Value |\n| --- | --- |\n| Alpha | 2 |\n| Alphabet | 1 |\n| Beta | 3 |';
    const render = async (text = source, documentId = 'file:///reading.md', fragment) => page.evaluate(message => window.dispatchEvent(new MessageEvent('message', {data:message})), {type:'render', ...renderMarkdown(text), preferences, documentationHome, documentId, fragment});
    await render();
    const search = page.locator('.table-search');
    await page.locator('.table-sort').nth(1).click();
    await page.locator('.table-density').selectOption('compact');
    await page.locator('.frontmatter-raw > summary').click();
    await page.locator('.frontmatter > summary').click();
    await search.fill('Alpha');
    await search.evaluate(input => input.setSelectionRange(1, 4, 'backward'));
    await render(source + '\n\nNew paragraph.');
    assert.equal(await search.evaluate(input => document.activeElement === input), true);
    assert.deepEqual(await search.evaluate(input => [input.value, input.selectionStart, input.selectionEnd, input.selectionDirection]), ['Alpha', 1, 4, 'backward']);
    assert.equal(await page.locator('.frontmatter').evaluate(el => el.open), false);
    assert.equal(await page.locator('.frontmatter-raw').evaluate(el => el.open), true);
    assert.equal(await page.locator('.table-panel').getAttribute('data-density'), 'compact');
    assert.equal(await page.locator('th').nth(1).getAttribute('aria-sort'), 'ascending');
    await page.keyboard.type('p');
    assert.equal(await search.inputValue(), 'Apa');
    // A different table inserted before this section must not move its interaction state.
    await search.fill('Alpha');
    await render('| Other |\n| --- |\n| New |\n\n' + source.replace(/^---[\s\S]*?---\n/, ''));
    assert.equal(await page.locator('.table-search').nth(0).inputValue(), '');
    assert.equal(await page.locator('.table-search').nth(1).inputValue(), 'Alpha');
    assert.equal(await page.locator('.table-search').nth(1).evaluate(input => document.activeElement === input), true);
    // Removed controls leave focus on the reading container, with no stale focus target.
    await render('# Inventory\n\nTable removed.');
    assert.equal(await page.locator('main.markdown').evaluate(el => document.activeElement === el), true);
    await render();
    await search.fill('Alpha');
    await page.getByRole('combobox', {name:'Style', exact:true}).focus();
    await render();
    assert.equal(await page.getByRole('combobox', {name:'Style', exact:true}).evaluate(el => document.activeElement === el), true);
    if (documentationHome) await page.getByRole('button', {name:'On this page', exact:true}).click();
    await page.locator('nav a').last().focus();
    await render();
    assert.equal(await page.locator('nav a').last().evaluate(el => document.activeElement === el), true);
    await page.locator('.frontmatter > summary').focus();
    await render();
    assert.equal(await page.locator('.frontmatter > summary').evaluate(el => document.activeElement === el), true);
    await search.focus();
    await render(source, 'file:///reading.md', 'inventory');
    assert.equal(await search.evaluate(input => document.activeElement === input), false);
    await render(source, 'file:///other.md');
    assert.equal(await search.inputValue(), '');
    assert.equal(await page.locator('.frontmatter').evaluate(el => el.open), true);
    assert.equal(await page.locator('.table-panel').getAttribute('data-density'), 'comfortable');
    await render(source, 'file:///reading.md');
    assert.equal(await search.inputValue(), 'Alpha');
    assert.equal(await search.evaluate(input => document.activeElement === input), false);
  });
}
