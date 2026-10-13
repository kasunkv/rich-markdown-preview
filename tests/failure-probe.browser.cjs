const { test } = require('./browser-fixtures.cjs');
const assert = require('node:assert/strict');
test('intentional assertion failure evidence probe', async ({ page, previewServer }) => {
  await page.goto(previewServer.url);
  await page.locator('.mermaid-result').first().waitFor();
  await page.evaluate(() => console.error('Current-run evidence probe'));
  assert.fail('Intentional harness assertion failure');
});
