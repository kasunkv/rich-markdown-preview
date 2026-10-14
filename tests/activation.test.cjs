const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {host} = require('./documentation-host.cjs');
test('startup and Documentation Home retain their action without loading the renderer', async () => {
  const h = host();
  assert.equal(h.status.visible, true);
  assert.equal(h.status.command, 'richMarkdownPreview.openDocumentationHome');
  assert.deepEqual(h.runtimeLoads, []);
  await h.open();
  assert.equal(h.latest('render').documentId, 'home');
  assert.deepEqual(h.runtimeLoads, []);
  h.files.set('/repo/README.md', '# Welcome\n\n```javascript\nconst answer = 42;\n```');
  await h.action('open', '/repo/README.md');
  assert.ok(h.runtimeLoads.length > 0);
  assert.match(h.latest('render').html, /Welcome/);
  assert.match(h.latest('render').html, /hljs-keyword/);
  const loaded = require.cache[require.resolve('../dist/render.cjs')];
  await h.action('open', '/repo/docs/guide.md');
  assert.equal(require.cache[require.resolve('../dist/render.cjs')], loaded);
  assert.match(h.latest('render').html, /Details/);
  h.panels[0].dispose();
});
test('activation bundle excludes heavyweight dependency composition and lazy asset is inventoried', () => {
  const extension = fs.readFileSync(path.join(__dirname, '../dist/extension.js'), 'utf8');
  assert.match(extension, /require\(["']\.\/render\.cjs["']\)/);
  assert.doesNotMatch(extension, /highlight\.js|markdown-it|node_modules\/yaml/);
  if (!extension.includes('__coverage__')) assert.ok(Buffer.byteLength(extension) <= 90000, 'production activation byte budget');
  assert.ok(require('../package.json').files.includes('dist/render.cjs'));
  // The source coverage build does not regenerate the production inventory.
  const inventory = require('../RUNTIME_DEPENDENCIES.json');
  assert.ok(inventory.bundles.some(item => item.file === 'dist/render.cjs'));
  assert.ok(inventory.components.some(item => item.name === 'highlight.js'));
});

test('runtime composition preserves every installed highlight grammar and keeps diagram code out of preview', () => {
  const inputs = require('../dist/runtime-composition.json');
  const bundled = inputs.filter(file => /highlight\.js\/lib\/languages\/[^/]+[.]js$/.test(file)).map(file => path.basename(file, '.js'));
  assert.deepEqual(bundled.sort(), require('highlight.js').listLanguages().sort());
  const preview = fs.readFileSync(path.join(__dirname, '../dist/preview.js'), 'utf8');
  assert.doesNotMatch(preview, /mermaid\.core|node_modules\/mermaid/);
  if (!preview.includes('__coverage__')) assert.ok(Buffer.byteLength(preview) < 70000, 'plain preview byte budget');
});
