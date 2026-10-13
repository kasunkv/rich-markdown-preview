const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../dist/render.cjs');
test('oversized source fails visibly without parsing or allocating render state', { timeout: 5000 }, () => {
  const result = renderMarkdown('x'.repeat(2_000_001));
  assert.match(result.html, /role="alert"/);
  assert.match(result.html, /2,000,000/);
  assert.deepEqual(result.outline, []);
  assert.deepEqual(result.references, []);
});
test('oversized diagrams fail visibly before Mermaid receives them', { timeout: 5000 }, () => {
  const result = renderMarkdown('```mermaid\n' + 'A'.repeat(20_001) + '\n```');
  assert.match(result.html, /diagram-error/);
  assert.match(result.html, /20,000/);
  assert.doesNotMatch(result.html, /mermaid-source/);
});
