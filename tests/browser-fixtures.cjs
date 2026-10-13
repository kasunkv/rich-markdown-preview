const fs = require('node:fs');
const { test: base } = require('@playwright/test');
const { startPreviewServer } = require('./preview-server.cjs');
const test = base.extend({
  previewServer: [
    async ({}, use) => {
      // The server lives in this worker: crashes cannot leave a child server behind.
      const server = await startPreviewServer();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker', timeout: 10000 },
  ],
  consoleEvidence: [
    async ({ page }, use, testInfo) => {
      const messages = [];
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'about:', 'blob:'].includes(url.protocol)
          ? route.continue()
          : route.abort('blockedbyclient');
      });
      page.on('console', (message) => messages.push(message.type() + ': ' + message.text()));
      page.on('pageerror', (error) => messages.push('pageerror: ' + error.stack));
      page.on('requestfailed', (request) =>
        messages.push('requestfailed: ' + request.url() + ' ' + request.failure()?.errorText),
      );
      try {
        await use();
      } finally {
        const file = testInfo.outputPath('console.log');
        fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
        fs.writeFileSync(file, messages.join('\n'));
        await testInfo.attach('browser-console', { path: file, contentType: 'text/plain' });
      }
    },
    { auto: true },
  ],
});
module.exports = { test };
