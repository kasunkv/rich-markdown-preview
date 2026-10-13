const { defineConfig } = require('@playwright/test');
const path = require('node:path');
if (!process.env.BROWSER_RUN_DIR) throw new Error('Use npm run test:browser:only for tagged browser evidence.');
module.exports = defineConfig({
  testDir: './tests',
  testMatch:
    process.env.BROWSER_PROBE === '1'
      ? 'failure-probe.browser.cjs'
      : process.env.BROWSER_MARKETING === '1'
        ? 'marketing.browser.cjs'
        : ['browser.cjs', 'documentation-browser.cjs', 'security.browser.cjs'],
  outputDir: path.join(process.env.BROWSER_RUN_DIR, 'artifacts'),
  timeout: 90000,
  globalTimeout: 180000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(process.env.BROWSER_RUN_DIR, 'report.json') }]],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    actionTimeout: 10000,
    navigationTimeout: 15000,
    launchOptions: { timeout: 30000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
