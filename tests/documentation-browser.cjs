const { test } = require('./browser-fixtures.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('../dist/render.cjs');

test('documentation browser regressions', async ({page}, testInfo) => {
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
    const paths = ['README.md', 'docs/guide.md', 'reports/2026/october/summary.MD', '.claude/skills/test/SKILL.md', 'docs/<img onerror=alert(1)>.md'];
    const files = paths.map(name => ({id: `file:///repo/${name}`, root: 'file:///repo', rootName: 'project', path: name}));
    files.push({id: 'file:///other/README.md', root: 'file:///other', rootName: 'other', path: 'README.md'});
    const sources = Object.fromEntries(files.map(file => [file.id, renderMarkdown(`# ${file.path}\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |\n\n${Array.from({length: 30}, (_, i) => `## Section ${i}\n\nDocumentation paragraph ${i}.`).join('\n\n')}`)]));
    await page.setContent('<!doctype html><html><head></head><body><div id="rmp-ui-app"></div></body></html>');
    await page.locator('#rmp-ui-app').evaluate((node, logo) => {node.dataset.logo = logo;}, `data:image/png;base64,${fs.readFileSync('assets/rich-markdown-preview.png').toString('base64')}`);
    await page.addStyleTag({path: path.resolve('dist/preview.css')});
    await page.evaluate(({files, sources}) => {
      let state, active, position = 0;
      const history = [undefined];
      const preferences = {style: 'documentation', appearance: 'light', contentWidth: 900, fontSize: 16, lineHeight: 1.7, wrapCode: false};
      window.actions = [];
      const emit = data => window.dispatchEvent(new MessageEvent('message', {data}));
      const index = () => emit({type: 'documentation', files, active, loading: false, canBack: position > 0, canForward: position < history.length - 1});
      const render = () => {emit({type: 'render', ...(active ? sources[active] : {html: '', outline: []}), preferences, documentationHome: true, documentId: active ?? 'home'}); index();};
      window.testIndex = index;
      window.readState = () => state;
      window.acquireVsCodeApi = () => ({getState: () => state, setState: value => {state = value;}, postMessage: message => {
        window.actions.push(message);
        if (message.type === 'ready') setTimeout(render, 0);
        if (message.type === 'preference') {preferences[message.key] = message.value; emit({type: 'preferences', preferences});}
        if (message.type !== 'documentationAction') return;
        if (message.action === 'open' || message.action === 'home') {
          active = message.action === 'open' ? message.id : undefined;
          history.splice(position + 1); history.push(active); position++;
        } else if (message.action === 'back') active = history[--position];
        else if (message.action === 'forward') active = history[++position];
        if (message.action !== 'source') render();
      }});
    }, {files, sources});
    await page.addScriptTag({path: path.resolve('dist/preview.js')});
    await page.getByRole('heading', {name: 'Documentation Home', exact: true}).waitFor();
    assert.equal(await page.locator('.documentation-cards section').count(), 2);
    assert.equal(await page.locator('.documentation-file').count(), 2);
    await page.locator('.documentation-cards').getByRole('button', {name: 'docs/ · 2 documents', exact: true}).click();
    assert.equal(await page.locator('.documentation-file:visible').count(), 2);
    assert.equal(await page.locator('.documentation-file img').count(), 0);
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('SKILL');
    const skill = page.getByRole('button', {name: 'SKILL.md', exact: true});
    await skill.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', {name: '.claude/skills/test/SKILL.md', exact: true}).waitFor();
    assert.equal(await skill.getAttribute('aria-current'), 'page');
    await page.getByRole('button', {name: 'On this page', exact: true}).click();
    assert.equal(await page.locator('#rmp-ui-outline a:visible').count(), 31);
    await page.getByRole('button', {name: 'Documents', exact: true}).click();
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('');
    checks.push('Multiple roots, folder home cards, nested filtering, safe filenames, keyboard selection, active file, outline tabs');

    await page.locator('.documentation-file').getByText('README.md', {exact: true}).first().click();
    await page.locator('.table-search').fill('Alpha');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.readState()?.scroll >= 1100);
    await page.locator('.documentation-folder > summary').filter({hasText: /^docs$/}).click();
    await page.getByRole('button', {name: 'guide.md', exact: true}).click();
    assert.equal(await page.locator('.table-search').inputValue(), '');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.getByRole('button', {name: '← Back', exact: true}).click();
    assert.equal(await page.locator('.table-search').inputValue(), 'Alpha');
    await page.waitForFunction(() => window.scrollY >= 1100);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', {name: 'Forward →', exact: true}).click();
    await page.getByRole('button', {name: 'Open source', exact: true}).click();
    assert.equal(await page.evaluate(() => window.actions.at(-1).action), 'source');
    checks.push('Per-document table and scroll state, Back/Forward history, source action');

    await page.getByRole('button', {name: 'Home', exact: true}).click();
    assert.equal(await page.getByRole('button', {name: 'Open source', exact: true}).isDisabled(), true);
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('missing-document');
    assert.equal(await page.getByText('No matching documents.', {exact: true}).isVisible(), true);
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('');
    await page.selectOption('#rmp-ui-appearance', 'dark');
    await page.setViewportSize({width: 520, height: 800});
    assert.equal(await page.locator('.documentation-sidebar').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', {name: 'Navigation', exact: true}).click();
    assert.equal(await page.locator('.documentation-sidebar').isVisible(), false);
    await page.getByRole('button', {name: 'Navigation', exact: true}).click();
    checks.push('Home return, empty search, dark theme, narrow layout and navigation toggle');
    await page.locator('.documentation-cards section').filter({hasText: 'other'}).getByRole('button', {name: 'Read README'}).click();
    await page.getByRole('button', {name: 'Home', exact: true}).click();
    assert.ok(await page.evaluate(() => window.readState()?.documents?.['file:///other/README.md']));
    const largeIndexMs = await page.evaluate(() => {
      const paths = [
        ...Array.from({length: 120}, (_, i) => `root-${String(i).padStart(3, '0')}.md`),
        ...Array.from({length: 120}, (_, i) => `section-${String(i).padStart(3, '0')}/index.md`),
        ...Array.from({length: 9760}, (_, i) => `docs/bulk/${String(i).padStart(5, '0')}.md`)
      ];
      const files = paths.map(path => ({id: `file:///repo/${path}`, root: 'file:///repo', rootName: 'project', path}));
      window.largeFiles = files;
      const start = performance.now();
      window.dispatchEvent(new MessageEvent('message', {data: {
        type: 'documentation', files, roots: ['file:///repo'], snapshot: 200, truncated: true,
        loading: false, canBack: false, canForward: false
      }}));
      return performance.now() - start;
    });
    assert.match(await page.locator('.documentation-notice').textContent(), /result limit reached/);
    assert.equal(await page.evaluate(() => !!window.readState()?.documents?.['file:///other/README.md']), false);
    assert.equal(await page.evaluate(() => !!window.readState()?.documents?.['file:///repo/README.md']), true);
    assert.ok(await page.locator('nav[aria-label="Documentation files"] *').count() < 500);
    assert.match(await page.locator('.documentation-cards').textContent(), /first 100 root documents/);
    assert.match(await page.locator('.documentation-cards').textContent(), /first 100 folders/);
    const rootMore = page.locator('nav[aria-label="Documentation files"] > details > .documentation-children > .documentation-more');
    await rootMore.click();
    assert.ok(await page.locator('nav[aria-label="Documentation files"] *').count() < 600);
    const docs = page.locator('nav[aria-label="Documentation files"] > details > .documentation-children > details').filter({hasText: /^docs/});
    if (!(await docs.evaluate(node => node.open))) await docs.locator(':scope > summary').click();
    await docs.locator(':scope > .documentation-children > details > summary').click();
    const bulk = page.locator('nav[aria-label="Documentation files"] summary').filter({hasText: /^bulk$/}).locator('..');
    await bulk.locator('.documentation-file').first().waitFor();
    assert.equal(await bulk.locator('.documentation-file').count(), 100);
    await bulk.getByRole('button', {name: /Show more \(9660 remaining\)/}).click();
    assert.equal(await bulk.locator('.documentation-file').count(), 200);
    assert.equal(await bulk.locator('.documentation-more').evaluate(node => document.activeElement === node), true);
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('bulk/09759.md');
    assert.equal(await page.getByRole('button', {name: '09759.md'}).isVisible(), true);
    await page.getByRole('searchbox', {name: 'Filter documentation files or folders'}).fill('');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: {
      type: 'documentation', files: window.largeFiles, roots: ['file:///repo'], snapshot: 200,
      active: 'file:///repo/docs/bulk/09759.md', truncated: true,
      loading: false, canBack: false, canForward: false
    }})));
    assert.equal(await page.locator('.documentation-file[aria-current="page"]').getAttribute('title'), 'docs/bulk/09759.md');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: {
      type: 'documentation', files: window.largeFiles, roots: ['file:///repo'], snapshot: 200,
      active: 'file:///repo/section-119/index.md', truncated: true,
      loading: false, canBack: false, canForward: false
    }})));
    assert.equal(await page.locator('.documentation-file[aria-current="page"]').getAttribute('title'), 'section-119/index.md');
    assert.equal(await page.locator('.documentation-file[aria-current="page"]').isVisible(), true);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: {
      type: 'documentation', files: [], snapshot: 201, complete: false,
      loading: false, canBack: false, canForward: false
    }})));
    assert.equal(await page.evaluate(() => !!window.readState()?.documents?.['file:///repo/README.md']), true);
    checks.push(`10k navigation update ${largeIndexMs.toFixed(1)}ms with bounded initial DOM`);
    assert.deepEqual(errors, []);
    await testInfo.attach('checks', {body: JSON.stringify(checks), contentType: 'application/json'});
    console.log(checks.map(check => `PASS ${check}`).join('\n'));
});
