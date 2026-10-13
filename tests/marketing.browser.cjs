const { test } = require('./browser-fixtures.cjs');
const path = require('node:path');
test('regenerate README marketing screenshots', async ({ page, previewServer }) => {
  await page.goto(previewServer.url);
  await page.locator('.mermaid-result').first().waitFor();
  for (const [style, appearance] of [
    ['editorial', 'light'],
    ['ocean', 'dark'],
  ]) {
    await page.selectOption('#rmp-ui-style', style);
    await page.selectOption('#rmp-ui-appearance', appearance);
    await page.waitForFunction(
      ({ style, appearance }) =>
        document.body.dataset.style === style && document.body.dataset.appearance === appearance,
      { style, appearance },
    );
    await page.screenshot({ path: path.resolve('docs/rich-markdown-preview-' + appearance + '.png') });
  }
});
