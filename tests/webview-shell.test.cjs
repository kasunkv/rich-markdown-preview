const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWebviewShell } = require('../dist/webview-shell.cjs');
const base = { nonce: '1234567890123456', cspSource: 'https://webview.test', scriptUri: 'https://webview.test/preview.js', styleUri: 'https://webview.test/preview.css', logoUri: 'https://webview.test/logo.png' };
test('production shell blocks networks by default and grants exact image origins only', () => {
  const html = buildWebviewShell(base);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /img-src https:\/\/webview.test data: ;/);
  assert.match(html, /script-src 'nonce-1234567890123456'/);
  assert.doesNotMatch(html, /unsafe-eval|img-src[^;]*https: /);
  assert.match(buildWebviewShell({ ...base, imageOrigins: ['https://images.test', 'https://images.test'] }), /img-src https:\/\/webview.test data: https:\/\/images.test;/);
});
test('shell rejects policy injection and escapes resource attributes', () => {
  for (const nonce of ['', 'short', "1234567890123456'; script-src *"]) assert.throws(() => buildWebviewShell({ ...base, nonce }));
  for (const cspSource of ['', 'https://webview.test;script-src *']) assert.throws(() => buildWebviewShell({ ...base, cspSource }));
  for (const origin of ['http://images.test', 'https://images.test/path', 'https://user:secret@images.test', 'https://images.test/', 'https://*.images.test', 'https://images.test:443', 'https://IMAGES.test', 'https://images..test']) assert.throws(() => buildWebviewShell({ ...base, imageOrigins: [origin] }));
  assert.match(buildWebviewShell({ ...base, logoUri: '\"><img src=x onerror=attack()>&' }), /data-logo="&quot;&gt;&lt;img src=x onerror=attack\(\)&gt;&amp;"/);
});
