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
// This source is below the source ceiling but expands beyond the message contract.
test('expanded outline overflow returns an actionable valid model rather than an unreceivable render', { timeout: 20000 }, () => {
  const result = renderMarkdown('### x\n'.repeat(100001));
  assert.match(result.html, /role="alert"/);
  assert.match(result.html, /rendered content.*supported/i);
  assert.deepEqual(result.outline, []);
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.externalImageOrigins, []);
});
test('reference expansion over the shared item limit returns empty safe host allowlists', { timeout: 20000 }, () => {
  const result = renderMarkdown('@a.md\n'.repeat(100001));
  assert.match(result.html, /rendered content.*supported/i);
  assert.deepEqual(result.outline, []);
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.externalImageOrigins, []);
});
test('expanded HTML and unreceivable heading fields return the same visible fallback', { timeout: 20000 }, () => {
  const expanded = renderMarkdown('![local](local.png)', () => 'x'.repeat(32 * 1024 * 1024 + 1));
  assert.match(expanded.html, /rendered content.*supported/i);
  assert.deepEqual(expanded.references, []);
  const heading = renderMarkdown('# ' + 'x'.repeat(8193));
  assert.match(heading.html, /rendered content.*supported/i);
  assert.deepEqual(heading.outline, []);
});
