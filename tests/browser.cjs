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
    await render('# ![Architecture](diagram.png)\n\nBuild **systems** and [guide](guide.md)\ncontinued\n---');
    assert.deepEqual(await page.locator('#rmp-ui-outline a').allTextContents(), ['Architecture', 'Build systems and guide continued']);
    assert.equal(await page.locator('#rmp-ui-outline a').first().getAttribute('href'), '#rmp-heading-architecture');
    checks.push('Accessible labels and stable navigation for image-only and multiline headings');
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

for (const documentationHome of [false, true]) {
  test(`reading interactions survive refresh (${documentationHome ? 'documentation' : 'single file'})`, async ({page, previewServer}) => {
    await page.goto(previewServer.url);
    await page.locator('.table-search').first().waitFor();
    const labels = await page.locator('.table-panel').first().locator('.table-sort > span:first-child').allTextContents();
    await page.evaluate(labels => sessionStorage.setItem('preview-state', JSON.stringify({tables:{[JSON.stringify([0, labels])]:{query:'legacy-migration',column:0,direction:'ascending',density:'compact'}}})), labels);
    await page.reload();
    assert.equal(await page.locator('.table-search').first().inputValue(), 'legacy-migration');
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
    for (const selector of ['.table-density', '.table-sort', '.table-copy']) {
      await page.locator(selector).first().focus();
      await render();
      assert.equal(await page.locator(selector).first().evaluate(el => document.activeElement === el), true);
    }
    await search.focus();
    await render(source + '\n\n```mermaid\ngraph TD; A-->B;\n```');
    await page.getByRole('combobox', {name:'Style', exact:true}).focus();
    await page.locator('.mermaid-result').waitFor();
    assert.equal(await page.getByRole('combobox', {name:'Style', exact:true}).evaluate(el => document.activeElement === el), true);
    await search.focus();
    await render(source, 'file:///reading.md', 'inventory');
    assert.equal(await search.evaluate(input => document.activeElement === input), false);
    await page.locator('.frontmatter > summary').click();
    await render(source, 'file:///other.md');
    assert.equal(await search.inputValue(), '');
    assert.equal(await page.locator('.frontmatter').evaluate(el => el.open), true);
    assert.equal(await page.locator('.table-panel').getAttribute('data-density'), 'comfortable');
    await render(source, 'file:///reading.md');
    assert.equal(await search.inputValue(), 'Alpha');
    assert.equal(await page.locator('.frontmatter').evaluate(el => el.open), false);
    assert.equal(await search.evaluate(input => document.activeElement === input), false);
  });
}
test('content anchors isolate UI, footnotes, duplicates and encoded fragments', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  await page.locator('.mermaid-result').first().waitFor();
  const source = '# Content\n# Style\n# Outline\n# App\n# Announcement\n# fn1\n# fnref1\n# rmp-ui-style\n# rmp-footnote-fn1\n# Café 日本語\n# Café 日本語\n# Café 日本語-1\n\nNote[^a] again[^a].\n\n[^a]: Note text.';
  const result = renderMarkdown(source);
  const preferences = {style:'ocean',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences});
  await page.evaluate(() => {
    window.anchorCalls = [];
    Element.prototype.scrollIntoView = function(options) { window.anchorCalls.push({id:this.id, options}); };
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  assert.equal(new Set(ids).size, ids.length);
  for (let index = 0; index < result.outline.length; index++) {
    const item = result.outline[index];
    await page.locator('#rmp-ui-outline a').nth(index).click();
    assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:item.id, options:{behavior:'auto', block:'start'}});
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(fragment);
      link.textContent = 'fragment';
      content.append(link);
      link.click();
      link.remove();
    }, item.fragment);
    assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:item.id, options:{behavior:'auto', block:'start'}});
  }
  await page.locator('.footnote-ref a').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:'rmp-footnote-fn1', options:{behavior:'auto', block:'start'}});
  await page.locator('.footnote-backref').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:'rmp-footnote-fnref1:1', options:{behavior:'auto', block:'start'}});
  const before = await page.evaluate(() => window.anchorCalls.length);
  for (const fragment of ['missing-anchor','rmp-ui-announcement','%E0%A4%A','L1-L3','L%31']) {
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.setAttribute('href', '#' + fragment);
      content.append(link); link.click(); link.remove();
    }, fragment);
    assert.match(await page.locator('#rmp-ui-announcement').textContent(), /Heading not found.*Line fragments.*Go to Line/);
  }
  assert.equal(await page.evaluate(() => window.anchorCalls.length), before);
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...result,preferences,fragment:encodeURIComponent('café-日本語-1')});
  await page.waitForFunction(() => window.anchorCalls.at(-1).id === 'rmp-heading-café-日本語-1');
  assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:'rmp-heading-café-日本語-1', options:{behavior:'auto', block:'start'}});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#rmp-ui-outline a').first().click();
  assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:result.outline[0].id, options:{behavior:'smooth', block:'start'}});
  await page.locator('#rmp-ui-content').evaluate(content => {
    const link = document.createElement('a'); link.href = '#content'; content.append(link); link.click(); link.remove();
  });
  assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id:'rmp-heading-content', options:{behavior:'smooth', block:'start'}});
  const footnotes = renderMarkdown('Note[^a] again[^a].\n\n[^a]: Note text.');
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), {type:'render',...footnotes,preferences});
  for (const [fragment, id] of [['fn1','rmp-footnote-fn1'], ['fnref1:1','rmp-footnote-fnref1:1']]) {
    await page.locator('#rmp-ui-content').evaluate((content, fragment) => {
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(fragment);
      content.append(link); link.click(); link.remove();
    }, fragment);
    assert.deepEqual(await page.evaluate(() => window.anchorCalls.at(-1)), {id, options:{behavior:'smooth', block:'start'}});
  }
});


test('external image policy sends zero blocked requests and no referrer for explicit grants', async ({ page, previewServer }) => {
  await page.goto(previewServer.url);
  await page.locator('#rmp-ui-content').waitFor();
  const requests = [];
  await page.route('https://privacy.example/**', async route => {
    requests.push({ url: route.request().url(), headers: route.request().headers() });
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>' });
  });
  const preferences = {style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const source = '![Tracking](https://privacy.example/pixel.svg)';
  const render = async grants => {
    const result = renderMarkdown(source, undefined, { grants });
    await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', {data})), { type: 'render', ...result, preferences });
  };
  await render(new Set());
  await page.locator('[data-external-image-action="grant"]').waitFor();
  await page.waitForTimeout(200);
  assert.equal(requests.length, 0);
  await render(new Set(['https://privacy.example']));
  await page.locator('#rmp-ui-content img').evaluate(img => img.scrollIntoView());
  await page.waitForFunction(() => document.querySelector('#rmp-ui-content img')?.naturalWidth === 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.referer, undefined);
  assert.equal(await page.locator('[data-external-image-action="revoke"]').count(), 1);
  await render(new Set());
  await page.locator('[data-external-image-action="grant"]').waitFor();
  await page.waitForTimeout(200);
  assert.equal(requests.length, 1);
});

test('concrete production-style image CSP blocks an injected ungranted origin', async ({ page, previewServer }) => {
  await page.goto(previewServer.url);
  await page.locator('#rmp-ui-content').waitFor();
  const requests = [];
  for (const origin of ['https://privacy.example', 'https://ungranted.example']) {
    await page.route(origin + '/**', async route => {
      requests.push(route.request().url());
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>' });
    });
  }
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'privacy-csp-proof';
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://privacy.example data:"><img src="https://privacy.example/allowed.svg" referrerpolicy="no-referrer"><img src="https://ungranted.example/blocked.svg">`;
    document.body.append(frame);
  });
  const frame = page.frameLocator('#privacy-csp-proof');
  await frame.locator('img').first().evaluate(img => new Promise(resolve => {
    if (img.complete) resolve(); else img.addEventListener('load', resolve, {once: true});
  }));
  assert.equal(await frame.locator('img').first().evaluate(img => img.naturalWidth), 2);
  assert.equal(await frame.locator('img').nth(1).evaluate(img => img.naturalWidth), 0);
  assert.deepEqual(requests, ['https://privacy.example/allowed.svg']);
});

test('permission HTML reset preserves bounded reading focus and respects intentional focus changes', async ({ page }) => {
  const directory = fs.mkdtempSync(path.join(path.resolve('.test-results'), 'privacy-focus-'));
  const fixture = path.join(directory, 'focus.md');
  fs.writeFileSync(fixture, '---\nname: private\n---\n# Privacy\n![Remote](https://privacy.example/image.svg)\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |');
  const server = await require('./preview-server.cjs').startPreviewServer({fixture});
  try {
    await page.goto(server.url);
    const filter = page.locator('.table-search');
    await filter.fill('Beta');
    await page.locator('.frontmatter > summary').click();
    await filter.focus();
    await filter.evaluate(input => input.setSelectionRange(1, 3, 'backward'));
    await page.locator('[data-external-image-action="grant"]').evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.externalImageActions.at(-1).type), 'grantExternalImageOrigin');
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('preview-state')));
    assert.ok(saved.permissionFocus.key.length <= 8192);
    assert.deepEqual(saved.permissionFocus.selection, [1, 3, 'backward']);
    await page.reload();
    await page.locator('.table-search').waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('table-search'));
    assert.equal(await page.locator('.table-search').inputValue(), 'Beta');
    assert.deepEqual(await page.locator('.table-search').evaluate(input => [input.selectionStart, input.selectionEnd, input.selectionDirection]), [1, 3, 'backward']);
    assert.equal(await page.locator('.frontmatter').getAttribute('open'), null);
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('preview-state')).permissionFocus), undefined);
    await page.locator('[data-external-image-action="grant"]').click();
    await page.locator('#rmp-ui-style').focus();
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('preview-state')).permissionFocus), undefined);
    await page.reload();
    await page.locator('.table-search').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search')), false);
    await page.locator('.table-search').evaluate(input => { input.dataset.readingKey = 'x'.repeat(8193); input.focus(); });
    await page.locator('[data-external-image-action="grant"]').evaluate(button => button.click());
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('preview-state')).permissionFocus), undefined);
  } finally { await server.close(); fs.rmSync(fixture); fs.rmdirSync(directory); }
});


test('failed permission persistence leaves grant blocked and immediately stops revoked requests', async ({page, previewServer}) => {
  const {ExternalImagePermissions} = require('./load-external-images.cjs');
  await page.goto(previewServer.url);
  await page.locator('#rmp-ui-content').waitFor();
  const requests = [];
  await page.route('https://privacy.example/**', async route => {
    requests.push(route.request().url());
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'});
  });
  const preferences = {style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const render = async (grants, name) => {
    const result = renderMarkdown(`![Private](https://privacy.example/${name}.svg)`, undefined, {grants});
    await page.evaluate(data => window.dispatchEvent(new MessageEvent('message',{data})), {type:'render',...result,preferences});
  };
  let stored = [];
  let fail = false;
  const renders = [];
  const policy = new ExternalImagePermissions({get: () => stored, update: async (_, origins) => {
    if (fail) throw Error('read-only user state'); stored = origins;
  }}, () => renders.push(render(policy.grants, 'granted')));
  await render(policy.grants, 'default');
  await page.locator('[data-external-image-action="grant"]').click();
  const grant = await page.evaluate(() => window.externalImageActions.at(-1));
  await policy.change('grant', grant.origin, () => true, async () => true);
  await Promise.all(renders);
  await page.waitForFunction(() => document.querySelector('#rmp-ui-content img')?.naturalWidth === 2);
  assert.deepEqual(requests, ['https://privacy.example/granted.svg']);
  fail = true;
  await page.locator('[data-external-image-action="revoke"]').click();
  const revoke = await page.evaluate(() => window.externalImageActions.at(-1));
  await assert.rejects(policy.change('revoke', revoke.origin, () => true, async () => true), /read-only/);
  await Promise.all(renders);
  assert.equal(stored.includes('https://privacy.example'), true);
  await render(policy.grants, 'revoked-new-request');
  await page.locator('[data-external-image-action="grant"]').waitFor();
  assert.equal(await page.locator('#rmp-ui-content img').count(), 0);
  const failedGrant = new ExternalImagePermissions({get: () => [], update: async () => {throw Error('read-only user state');}});
  await assert.rejects(failedGrant.change('grant', grant.origin, () => true, async () => true), /read-only/);
  await render(failedGrant.grants, 'failed-grant-new-request');
  await page.locator('[data-external-image-action="grant"]').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#rmp-ui-content img').count(), 0);
  assert.deepEqual(requests, ['https://privacy.example/granted.svg']);
});

test('image permission changes keep table reading keys stable inside image headings', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  await page.locator('#rmp-ui-content').waitFor();
  await page.route('https://privacy.example/**', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'}));
  const source = '# Logo ![Map](https://privacy.example/map.svg)\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |';
  const preferences = {style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const render = async grants => {
    const result = renderMarkdown(source, undefined, {grants});
    await page.evaluate(data => window.dispatchEvent(new MessageEvent('message',{data})), {type:'render',...result,preferences});
  };
  await render(new Set());
  const filter = page.locator('.table-search');
  await filter.fill('Beta'); await filter.evaluate(input => input.setSelectionRange(1,3,'backward'));
  const key = await filter.getAttribute('data-reading-key');
  await render(new Set(['https://privacy.example']));
  assert.equal(await filter.inputValue(), 'Beta');
  assert.equal(await filter.getAttribute('data-reading-key'), key);
  assert.deepEqual(await filter.evaluate(input => [input.selectionStart,input.selectionEnd,input.selectionDirection]), [1,3,'backward']);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search')), true);
  await render(new Set());
  assert.equal(await filter.inputValue(), 'Beta');
  assert.equal(await filter.getAttribute('data-reading-key'), key);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search')), true);
});

test('linked image permission controls are keyboard accessible without opening author links', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  await page.locator('#rmp-ui-content').waitFor();
  const preferences = {style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const result = renderMarkdown('[![Private](https://privacy.example/a)](https://link.example)');
  await page.evaluate(data => window.dispatchEvent(new MessageEvent('message',{data})), {type:'render',...result,preferences});
  const action = page.locator('[data-external-image-action="grant"]');
  assert.equal(await action.evaluate(button => button.closest('a') === null), true);
  await action.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.externalImageActions.at(-1).origin), 'https://privacy.example');
  assert.equal(await page.evaluate(() => window.externalLinkClicks?.length ?? 0), 0);
  assert.equal(page.url(), previewServer.url + '/');
  await action.evaluate(button => {
    const link = document.createElement('a'); link.href = 'https://link.example'; button.replaceWith(link); link.append(button);
    delete button.dataset.externalImageOrigin;
  });
  await page.locator('.external-image-action').click();
  assert.equal(await page.evaluate(() => window.externalImageActions.length), 1);
  assert.equal(page.url(), previewServer.url + '/');
  await action.evaluate(button => {button.dataset.externalImageOrigin = 'https://privacy.example'; button.dataset.externalImageAction = 'authorize';});
  await page.locator('.external-image-action').click();
  assert.equal(await page.evaluate(() => window.externalImageActions.length), 1);
  assert.equal(await page.evaluate(() => window.externalLinkClicks?.length ?? 0), 0);
  assert.equal(page.url(), previewServer.url + '/');
});


test('shared contracts reject malformed inbound state and correlate overlapping actions', async ({page, previewServer}) => {
  await page.addInitScript(() => sessionStorage.setItem('preview-state', JSON.stringify({tables:[],documents:{file:{scroll:'bad'}},documentation:{expanded:[1]}})));
  await page.route(previewServer.url + '/', async route => {
    const response = await route.fetch(); let html = await response.text();
    html = html.replace('</script><script data-diagram-runtime="/diagrams.js" src="/preview.js">', '</script><script>const originalApi = acquireVsCodeApi; acquireVsCodeApi = () => { const api = originalApi(); return {...api,postMessage: message => {window.contractRequests ??= []; window.contractRequests.push(message); if (!["copy","tableCopy","tableExport"].includes(message.type)) return api.postMessage(message);}}; };</script><script data-diagram-runtime="/diagrams.js" src="/preview.js">');
    await route.fulfill({response,body:html});
  });
  await page.goto(previewServer.url); await page.locator('.mermaid-result').first().waitFor();
  const emit = async value => page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})), value);
  const preferences = {style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const render = {type:'render',...renderMarkdown('# Contract\n\n~~~js\nconst value = 1;\n~~~\n\n| Name | Value |\n| --- | --- |\n| Formula | =SUM(1) |'),preferences,documentId:'file:///contract.md',renderId:'contract_1'};
  await emit(render); await page.locator('.copy-code').click(); await page.locator('.copy-code').click();
  const copies = await page.evaluate(() => window.contractRequests.filter(message => message.type === 'copy'));
  assert.equal(copies.length,2); assert.notEqual(copies[0].requestId,copies[1].requestId); assert.equal(copies[0].renderId,'contract_1');
  await emit({type:'copyResult',requestId:copies[0].requestId,success:true});
  assert.equal(await page.locator('#rmp-ui-announcement').innerText(),'Copying code…');
  await emit({type:'copyResult',requestId:copies[1].requestId,success:false});
  assert.equal(await page.locator('#rmp-ui-announcement').innerText(),'Could not copy code. Please try again.');
  await page.getByRole('button',{name:'Copy CSV',exact:true}).click();
  const csv = await page.evaluate(() => window.contractRequests.at(-1)); assert.equal(csv.type,'tableCopy'); assert.match(csv.text,/\'=SUM/);
  await emit({type:'tableActionResult',requestId:csv.requestId,action:'tableExport',success:true});
  assert.equal(await page.locator('#rmp-ui-announcement').innerText(),'Copying table CSV…');
  await emit({type:'tableActionResult',requestId:csv.requestId,action:'tableCopy',success:true});
  assert.equal(await page.locator('#rmp-ui-announcement').innerText(),'Table CSV copied');
  await emit({...render,renderId:'contract_2'});
  await emit({type:'copyResult',requestId:copies[1].requestId,success:true});
  assert.equal(await page.locator('#rmp-ui-announcement').innerText(),'Table CSV copied');
  await emit({...render,html:'<h1>Poisoned</h1>',preferences:{...preferences,fontSize:'bad'}});
  assert.equal(await page.locator('#rmp-ui-content h1').innerText(),'Contract');
  await emit({...render,outline:[{id:'rmp-heading-contract',fragment:'contract',text:'Invalid',level:20}]});
  assert.equal(await page.locator('#rmp-ui-outline a').first().innerText(),'Contract');
  await emit({type:'preferences',preferences:{...preferences,style:'unknown'}});
  assert.equal(await page.locator('#rmp-ui-style').inputValue(),'documentation');
  const sent = await page.evaluate(() => window.contractRequests.length);
  await page.locator('.code-block code').evaluate(code => {code.textContent = 'x'.repeat(4194305);});
  await page.locator('.copy-code').click();
  assert.match(await page.locator('#rmp-ui-announcement').innerText(),/Try selecting a smaller portion/);
  assert.equal(await page.evaluate(() => window.contractRequests.length),sent);
  await page.evaluate(preferences => window.dispatchEvent(new MessageEvent('message',{data:{type:'render',html:'<div class="table-scroll"><table><thead><tr><th>Data</th></tr></thead><tbody><tr><td>'+ 'x'.repeat(4194305) +'</td></tr></tbody></table></div>',outline:[],preferences,documentId:'file:///large.md',renderId:'large_model'}})),preferences);
  await page.getByRole('button',{name:'Copy CSV',exact:true}).click();
  assert.match(await page.locator('#rmp-ui-announcement').innerText(),/Try filtering to fewer rows/);
  assert.equal(await page.evaluate(() => window.contractRequests.length),sent);
});

test('high contrast overrides presets and rendered diagrams retain keyboard alternatives', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  const result = renderMarkdown('# Accessible reading\n\n```mermaid\ngraph TD; Reader-->Source\n```');
  await page.evaluate(result => window.dispatchEvent(new MessageEvent('message', {data:{type:'render', ...result, preferences:{style:'ocean',appearance:'auto',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false}}})), result);
  await page.locator('.mermaid-result svg').waitFor();
  assert.equal(await page.locator('.diagram-source .mermaid-source').count(), 1);
  const summary = page.locator('.diagram-source summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.diagram-source').getAttribute('open'), '');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'mermaid-source');
  assert.match(await page.locator('.mermaid-result svg').getAttribute('aria-label'), /graph diagram/);
  for (const style of manifest.contributes.configuration.properties['richMarkdownPreview.style'].enum) {
    for (const appearance of ['auto','light','dark']) {
      for (const theme of ['vscode-high-contrast','vscode-high-contrast-light']) {
        const colors = await page.evaluate(({style,appearance,theme}) => {
          document.body.className = theme;
          document.body.dataset.style = style;
          document.body.dataset.appearance = appearance;
          const css = getComputedStyle(document.body);
          return {bg:css.backgroundColor,text:css.color,scheme:css.colorScheme};
        }, {style,appearance,theme});
        assert.deepEqual(colors, theme === 'vscode-high-contrast'
          ? {bg:'rgb(0, 0, 0)',text:'rgb(255, 255, 255)',scheme:'dark'}
          : {bg:'rgb(255, 255, 255)',text:'rgb(0, 0, 0)',scheme:'light'}, `${style}/${appearance}/${theme}`);
      }
    }
  }
});

test('computed cascades meet text and control contrast across every appearance and preset', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  const result = renderMarkdown('# Contrast\n\n###### Small heading\n\nBody [link](#contrast) and `inline code`.\n\n> Muted quote\n\n> [!TIP]\n> Tip content.\n\n> [!IMPORTANT]\n> Important content.\n\n> [!WARNING]\n> Warning content.\n\n> [!CAUTION]\n> Caution content.\n\n```js\nconst value = 123; // comment\n"string";\n```\n\n| Name | Count |\n|---|---|\n| Alpha | 1 |\n| Beta | 2 |');
  await page.evaluate(result => window.dispatchEvent(new MessageEvent('message', {data:{type:'render', ...result, preferences:{style:'ocean',appearance:'auto',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false}}})), result);
  for (const style of manifest.contributes.configuration.properties['richMarkdownPreview.style'].enum) {
    for (const appearance of ['auto','light','dark']) {
      for (const theme of ['vscode-light','vscode-dark','vscode-high-contrast','vscode-high-contrast-light']) {
        const failures = await page.evaluate(({style,appearance,theme}) => {
          document.body.className = theme;
          Object.assign(document.body.dataset,{style,appearance});
          const canvas = document.createElement('canvas'); canvas.width=canvas.height=1;
          const ctx=canvas.getContext('2d');
          const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(n=>n/255);};
          const blend=(a,b)=>a.slice(0,3).map((n,i)=>n*a[3]+b[i]*(1-a[3]));
          const background=el=>{const chain=[];for(let node=el;node;node=node.parentElement)chain.unshift(node);let bg=[1,1,1];for(const node of chain)bg=blend(rgba(getComputedStyle(node).backgroundColor),bg);return bg;};
          const luminance=rgb=>rgb.map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
          const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
          const failures=[];
          const check=(el,property,min)=>{const css=getComputedStyle(el), bg=background(el);const r=ratio(blend(rgba(css[property]),bg),bg);if(r+.01<min)failures.push(`${el.tagName}.${el.className} ${property} ${r.toFixed(2)} < ${min}`);};
          for(const el of document.querySelectorAll('.markdown p,.markdown h6,.markdown a,.markdown code,.hljs-keyword,.hljs-string,.hljs-number,.hljs-comment,.controls label,.code-toolbar,.table-count,.table-sort,td,.markdown-alert-title,.external-image-blocked,.diagram-label,.diagram-source summary,.diagram-error'))check(el,'color',4.5);
          for(const el of document.querySelectorAll('select,input[type="number"],.table-search,button:not(:disabled):not(.table-sort)'))check(el,'borderTopColor',3);
          document.querySelector('#rmp-ui-toggle-outline').focus();
          check(document.activeElement,'outlineColor',3);
          document.querySelector('.table-sort').focus();
          check(document.activeElement,'outlineColor',3);
          return failures;
        }, {style,appearance,theme});
        assert.deepEqual(failures,[],`${style}/${appearance}/${theme}`);
      }
    }
  }
});

test('keyboard CSS zoom reflow proxy and reduced motion accessibility smoke', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  const result = renderMarkdown('---\ntitle: Accessible reading\n---\n\n# Keyboard reading\n\n[Heading link](#keyboard-reading)\n\n```mermaid\ngraph TD; Reader-->Source\n```\n\n| Name | Count |\n|---|---|\n| Alpha | 1 |\n| Beta | 2 |');
  await page.evaluate(result => window.dispatchEvent(new MessageEvent('message',{data:{type:'render',...result,preferences:{style:'ocean',appearance:'auto',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false}}})),result);
  await page.locator('.mermaid-result').first().waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  for(const zoom of [2,4]) {
    // 1280 CSS px at normal scale becomes 640/320 at browser zoom. CSS zoom
    // scales controls/text and layout together while preserving keyboard input.
    await page.setViewportSize({width:1280,height:1000});
    await page.evaluate(zoom=>document.body.style.zoom=String(zoom),zoom);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    assert.equal(overflow,false,`${zoom*100}% page reflow`);
    await page.locator('#rmp-ui-toggle-outline').focus();
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#rmp-ui-toggle-outline').getAttribute('aria-expanded'),'true');
    const summary=page.locator('.frontmatter > summary').first();
    await summary.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    const sort=page.locator('.table-sort').first();
    await sort.focus(); await page.keyboard.press('Enter');
    assert.match(await sort.locator('..').getAttribute('aria-sort'),/ascending|descending/);
    assert.equal(await page.locator('.table-count').first().getAttribute('aria-live'),'polite');
  }
});

test('authored diagram alternatives and accessibility tokens survive rendering and refresh', async ({page,previewServer}) => {
  await page.goto(previewServer.url);
  const source='# Workflow\n\n```mermaid\nflowchart TD\naccTitle: Reading workflow\naccDescr: The reader opens a source alternative.\nReader-->Source\n```';
  const render=async text=>{
    const result=renderMarkdown(text);
    await page.evaluate(result=>window.dispatchEvent(new MessageEvent('message',{data:{type:'render',...result,preferences:{style:'aurora',appearance:'dark',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false}}})),result);
    await page.locator('.mermaid-result svg').first().waitFor();
  };
  await render(source);
  const image=page.locator('.mermaid-result svg');
  assert.equal(await image.locator('title').textContent(),'Reading workflow');
  assert.equal(await image.locator('desc').textContent(),'The reader opens a source alternative.');
  assert.ok(await image.getAttribute('aria-labelledby'));
  assert.ok(await image.getAttribute('aria-describedby'));
  const summary=page.locator('.diagram-source summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await render(source+'\n\nUnrelated addition.');
  assert.equal(await page.locator('.diagram-source').getAttribute('open'),'');
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
  await page.locator('.diagram-source pre').focus();
  await render(source+'\n\nSource reader refresh.');
  assert.equal(await page.evaluate(()=>document.activeElement.className),'mermaid-source','Live redraw preserves keyboard source-pane focus');
  const pairedSource=source+'\n\n```mermaid\nflowchart TD\nSecond-->Reader\n```';
  await render(pairedSource);
  await page.locator('.diagram-source summary').nth(1).click();
  await page.locator('.diagram-source pre').nth(1).focus();
  await render(pairedSource+'\n\nSecond source reader refresh.');
  assert.equal(await page.locator('.diagram-source pre').nth(1).evaluate(el=>document.activeElement===el),true,'Repeated source disclosures keep distinct focus identities');
  const heading=page.locator('#rmp-heading-workflow');
  await heading.evaluate(el=>el.setAttribute('tabindex','0'));
  await page.locator('#rmp-ui-outline a').first().focus(); await page.keyboard.press('Enter');
  assert.equal(await heading.getAttribute('tabindex'),'0','Authored tabindex is preserved during navigation');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'rmp-heading-workflow');
  await render(source+'\n\nLive redraw while reading.');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'rmp-heading-workflow','Live redraw preserves reading focus');
  for(const [theme,bg,text,accent] of [['vscode-high-contrast','#101010','#eeeeee','#ffff00'],['vscode-high-contrast-light','#fafafa','#111111','#000088']]) {
    const actual=await page.evaluate(({theme,bg,text,accent})=>{
      document.body.className=theme;
      for(const [key,value] of Object.entries({'--vscode-editor-background':bg,'--vscode-editor-foreground':text,'--vscode-textLink-foreground':accent,'--vscode-focusBorder':accent,'--vscode-contrastBorder':text}))document.body.style.setProperty(key,value);
      const summary=document.querySelector('.diagram-source summary');summary.focus();
      const body=getComputedStyle(document.body),focus=getComputedStyle(summary);
      return {bg:body.backgroundColor,text:body.color,focus:focus.outlineColor};
    },{theme,bg,text,accent});
    assert.deepEqual(actual,theme==='vscode-high-contrast'?{bg:'rgb(16, 16, 16)',text:'rgb(238, 238, 238)',focus:'rgb(255, 255, 0)'}:{bg:'rgb(250, 250, 250)',text:'rgb(17, 17, 17)',focus:'rgb(0, 0, 136)'});
  }
});

test('linked table headers preserve links through all sort states and density changes', async ({page, previewServer}) => {
  await page.goto(previewServer.url);
  const preferences = {style:'reading',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
  const model = renderMarkdown('| [Guide](guide.md) | |\n| --- | --- |\n| 2 | A |\n| 1 | B |');
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message',{data:message})),{type:'render',...model,preferences});
  const header = page.locator('.table-panel th').first();
  assert.equal(await header.locator('button a').count(),0);
  assert.match(await header.locator('a').textContent(), /Guide$/);
  const sort = header.locator('button');
  await sort.click(); assert.equal(await header.getAttribute('aria-sort'),'ascending');
  await sort.click(); assert.equal(await header.getAttribute('aria-sort'),'descending');
  await sort.click(); assert.equal(await header.getAttribute('aria-sort'),null);
  await page.locator('.table-density').selectOption('compact');
  assert.equal(await page.locator('.table-panel').getAttribute('data-density'),'compact');
  await page.locator('.table-density').selectOption('comfortable');
  assert.equal(await page.locator('.table-panel').getAttribute('data-density'),'comfortable');
  await header.locator('a').click();
  assert.equal(await page.evaluate(() => window.referenceClicks.at(-1).id),await header.locator('a').getAttribute('data-reference-id'));
});
