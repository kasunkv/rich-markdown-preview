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
    assert.equal(await page.locator('#rmp-ui-style option').count(), 18);
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
    assert.equal(await page.locator('#rmp-ui-outline a').count(), 1);
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
    await page.locator('#rmp-ui-outline a').first().click();
    await render('# Numeric target\n\n[Jump to heading](#numeric-target)');
    await page.locator('#rmp-ui-content a').click();
    await render('[External reference](https://example.com)');
    await page.locator('#rmp-ui-content a').click();
    await render(fs.readFileSync(path.resolve(__dirname, '../samples/showcase.md'), 'utf8'));
    const widthValue = page.locator('[data-preference-key="contentWidth"][type="number"]');
    const widthSlider = page.locator('[data-preference-key="contentWidth"][type="range"]');
    const widthOutput = page.locator('[data-preference-output="contentWidth"]');
    for (const [key, min, max] of [['contentWidth',480,1600], ['fontSize',12,24], ['lineHeight',1.3,2.2]]) {
      const control = page.locator(`[data-preference-key="${key}"][type="number"]`);
      assert.equal(await control.getAttribute('min'), String(min));
      assert.equal(await control.getAttribute('max'), String(max));
    }
    await widthValue.fill('901');
    assert.equal(await widthSlider.inputValue(), '901');
    assert.equal(await widthOutput.textContent(), '901px');
    await widthValue.fill('901.25');
    assert.equal(await widthSlider.inputValue(), '901.25');
    assert.equal(await widthOutput.textContent(), '901.25px');
    await page.locator('[data-preference-key="fontSize"]').fill('17');
    await page.locator('[data-preference-key="lineHeight"]').fill('1.8');
    assert.equal(await page.locator('[data-preference-key="fontSize"]').inputValue(), '17');
    assert.equal(await page.locator('[data-preference-key="lineHeight"]').inputValue(), '1.8');
    await page.locator('[data-preference-key="fontSize"]').fill('17.25');
    await page.locator('[data-preference-key="lineHeight"]').fill('1.83');
    assert.equal(await page.locator('[data-preference-key="fontSize"]').inputValue(), '17.25');
    assert.equal(await page.locator('[data-preference-key="lineHeight"]').inputValue(), '1.83');
    assert.equal(await page.locator('#rmp-ui-content').evaluate(el => getComputedStyle(el).fontSize), '17.25px');
    assert.equal(await page.locator('#rmp-ui-content').evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--reading-line-height').trim()), '1.83');
    assert.equal(await page.locator('#rmp-ui-content').evaluate(el => getComputedStyle(el).maxWidth), '901.25px');
    await page.locator('[data-preference-key="fontSize"]').fill('99');
    await page.locator('[data-preference-key="fontSize"]').dispatchEvent('change');
    assert.equal(await page.locator('[data-preference-key="fontSize"]').inputValue(), '17.25');
    checks.push('Continuous numeric controls preserve integer and fractional values, synchronize the width slider/output, and reject invalid bounds');
    for (const appearance of ['light','dark']) {
      for (const style of manifest.contributes.configuration.properties['richMarkdownPreview.style'].enum) {
        await page.selectOption('#rmp-ui-style', style); await page.selectOption('#rmp-ui-appearance', appearance);
        await page.waitForFunction(({style,appearance}) => document.body.dataset.style===style && document.body.dataset.appearance===appearance, {style,appearance});
        assert.ok(await page.locator('#rmp-ui-content').evaluate(el => getComputedStyle(el).color !== getComputedStyle(document.body).backgroundColor));
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
    await page.waitForFunction(() => document.getElementById('rmp-ui-announcement').textContent === 'Table CSV copied');
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
    await page.waitForFunction(() => document.getElementById('rmp-ui-announcement').textContent === 'Code copied');
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n','\n'),'const value = 42;\n');
    await page.check('#rmp-ui-wrapCode'); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('wrap-code')),true);
    await page.click('#rmp-ui-toggle-outline'); assert.equal(await page.locator('.outline').isVisible(),false);
    await page.click('#rmp-ui-toggle-outline'); assert.equal(await page.locator('#rmp-ui-toggle-outline').getAttribute('aria-expanded'),'true');
    await page.selectOption('#rmp-ui-appearance','auto');
    const before = await page.locator('.mermaid-result svg').getAttribute('id');
    await page.evaluate(() => document.body.classList.add('vscode-dark'));
    await page.waitForFunction(before => document.querySelector('.mermaid-result svg')?.id !== before, before);
    checks.push('Code copy, wrap, outline, and Mermaid refresh on automatic theme changes');
    await render('```mermaid\ninvalid diagram syntax\n```'); await page.locator('.diagram-error').waitFor();
    assert.match(await page.locator('.mermaid-source').innerText(), /invalid diagram syntax/);
    await render(''); assert.equal(await page.locator('.empty').isVisible(),true);
    await page.setViewportSize({width:520,height:800});
    assert.equal(await page.locator('#rmp-ui-toggle-outline').isVisible(),true);
    checks.push('Invalid diagram recovery, empty preview, and narrow viewport controls');
    assert.deepEqual(errors, []);
    await testInfo.attach('checks', {body: JSON.stringify(checks), contentType: 'application/json'});
    console.log(checks.map(check => `PASS ${check}`).join('\n'));
});

test('content anchors isolate UI, footnotes, duplicates and encoded fragments', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  await page.locator('.mermaid-result').first().waitFor();
  const source = '# Content\n# Style\n# Outline\n# App\n# Announcement\n# fn1\n# fnref1\n# rmp-ui-style\n# rmp-footnote-fn1\n# Café 日本語\n# Café 日本語\n# Café 日本語-1\n\nNote[^a] again[^a].\n\n[^a]: Note text.';
  const result = renderMarkdown(source);
  const preferences = {style:'ocean',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences});
  await page.evaluate(() => {
    window.anchorCalls = [];
    Element.prototype.scrollIntoView = function() { window.anchorCalls.push(this.id); };
  });
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  assert.equal(new Set(ids).size, ids.length);
  for (let index = 0; index < result.outline.length; index++) {
    const item = result.outline[index];
    await page.locator('#rmp-ui-outline a').nth(index).click();
    assert.equal(await page.evaluate(() => window.anchorCalls.at(-1)), item.id);
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(fragment);
      link.textContent = 'fragment';
      content.append(link);
      link.click();
      link.remove();
    }, item.fragment);
    assert.equal(await page.evaluate(() => window.anchorCalls.at(-1)), item.id);
  }
  await page.locator('.footnote-ref a').nth(1).click();
  assert.equal(await page.evaluate(() => window.anchorCalls.at(-1)), 'rmp-footnote-fn1');
  await page.locator('.footnote-backref').nth(1).click();
  assert.equal(await page.evaluate(() => window.anchorCalls.at(-1)), 'rmp-footnote-fnref1:1');
  const before = await page.evaluate(() => window.anchorCalls.length);
  for (const fragment of ['missing-anchor','rmp-ui-announcement','%E0%A4%A']) {
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.setAttribute('href', '#' + fragment);
      content.append(link); link.click(); link.remove();
    }, fragment);
  }
  assert.equal(await page.evaluate(() => window.anchorCalls.length), before);
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences,fragment:encodeURIComponent('café-日本語-1')});
  await page.waitForFunction(() => window.anchorCalls.at(-1) === 'rmp-heading-café-日本語-1');
  const footnotes = renderMarkdown('Note[^a] again[^a].\n\n[^a]: Note text.');
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...footnotes,preferences});
  for (const [fragment, id] of [['fn1','rmp-footnote-fn1'], ['fnref1:1','rmp-footnote-fnref1:1']]) {
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(fragment);
      content.append(link); link.click(); link.remove();
    }, fragment);
    assert.equal(await page.evaluate(() => window.anchorCalls.at(-1)), id);
  }
});
