const { test } = require('./browser-fixtures.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');

test('long reading sessions bound saved bytes and scroll writes without losing navigation positions', async ({ page }) => {
  await page.setContent('<!doctype html><html><body><div id="rmp-ui-app"></div></body></html>');
  await page.evaluate(() => {
    let state = { readingStateVersion: 2, documents: { stale: { scroll: 99 } } };
    window.savedReading = () => state;
    window.writeCount = 0;
    window.seenIds = [];
    window.acquireVsCodeApi = () => ({
      getState: () => state,
      setState: value => { state = value; window.writeCount++; },
      postMessage() {},
    });
    window.renderReading = id => { window.seenIds.push(id); window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'render', documentId: id, html: '<h1>Reading</h1><div style="height:3000px">Long document</div>',
      outline: [], preferences: { style: 'documentation', appearance: 'light', contentWidth: 900,
        fontSize: 16, lineHeight: 1.7, wrapCode: false },
    } })); };
  });
  await page.addScriptTag({ path: path.resolve('dist/preview.js') });
  await page.evaluate(() => {
    for (let index = 0; index < 160; index++) window.renderReading(`file:///docs/${index}.md`);
  });
  await page.waitForTimeout(250);
  const visits = await page.evaluate(() => ({
    bytes: new TextEncoder().encode(JSON.stringify(window.savedReading())).length,
    order: window.savedReading().documentOrder,
    active: window.savedReading().documentId,
    lastInput: window.seenIds.at(-1),
    stale: window.savedReading().documents.stale,
  }));
  assert.ok(visits.bytes <= 65536, `saved reading state used ${visits.bytes} bytes`);
  assert.ok(visits.order.length <= 24);
  assert.equal(visits.active, visits.lastInput);
  assert.equal(visits.active, 'file:///docs/159.md');
  assert.equal(visits.stale, undefined);

  const writes = await page.evaluate(async () => {
    const before = window.writeCount;
    window.scrollTo(0, 900);
    for (let index = 0; index < 250; index++) window.dispatchEvent(new Event('scroll'));
    const immediate = window.writeCount - before;
    await new Promise(resolve => setTimeout(resolve, 260));
    return { immediate, settled: window.writeCount - before };
  });
  assert.equal(writes.immediate, 0);
  assert.ok(writes.settled <= 2, `250 scroll events caused ${writes.settled} saved writes`);

  await page.evaluate(() => {
    window.scrollTo(0, 1200);
    window.dispatchEvent(new Event('scroll'));
    window.renderReading('file:///docs/next.md');
  });
  assert.equal(await page.evaluate(() => window.savedReading().documents['file:///docs/159.md'].scroll), 1200);
  await page.evaluate(() => {
    window.scrollTo(0, 700);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));
  });
  assert.equal(await page.evaluate(() => window.savedReading().scroll), 700);
  await page.evaluate(() => {
    window.scrollTo(0, 500);
    window.dispatchEvent(new Event('scroll'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  assert.equal(await page.evaluate(() => window.savedReading().scroll), 500);
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'documentation', files: [{ id: 'file:///docs/next.md', root: 'file:///docs', rootName: 'docs', path: 'next.md' }],
    active: 'file:///docs/next.md', loading: false, canBack: false, canForward: false,
  } })));
  assert.deepEqual(await page.evaluate(() => Object.keys(window.savedReading().documents)), ['file:///docs/next.md']);
  await page.evaluate(() => {
    const files = Array.from({ length: 140 }, (_, index) => ({ id: `file:///docs/folder${index}/a.md`,
      root: 'file:///docs', rootName: 'docs', path: `folder${index}/a.md` }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'documentation', files,
      loading: false, canBack: false, canForward: false } }));
    for (const details of document.querySelectorAll('.documentation-folder')) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    }
  });
  assert.ok((await page.evaluate(() => window.savedReading().documentation.expanded.length)) <= 128);
  await page.getByRole('searchbox', { name: 'Filter documentation' }).fill('x'.repeat(700));
  assert.equal(await page.evaluate(() => window.savedReading().documentation.filter.length), 512);
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'documentation', files: [{ id: 'file:///docs/folder139/a.md', root: 'file:///docs',
      rootName: 'docs', path: 'folder139/a.md' }], loading: false, canBack: false, canForward: false,
  } })));
  assert.ok(await page.evaluate(() => window.savedReading().documentation.expanded.every(key =>
    key === 'file:///docs' || key === 'file:///docs/folder139')));
});
