const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../dist/render.cjs');
test('renders tables, highlighted code, and Mermaid without executing markup', () => {
  const { html } = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B\n```');
  assert.match(html, /<table>/); assert.match(html, /hljs-keyword/); assert.match(html, /mermaid-source/);
});
test('escapes raw HTML and rejects executable links', () => {
  const { html } = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n```unknown\n<img onerror="alert(1)">\n```');
  assert.doesNotMatch(html, /<script>|<img|href="javascript:/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/);
});
test('uses unique heading anchors and resolves local image resources', () => {
  const result = renderMarkdown('# Hello\n## Hello\n\n![demo](images/demo.png)', src => `safe-resource/${src}`);
  assert.deepEqual(result.outline.map(h => h.id), ['hello', 'hello-1']); assert.match(result.html, /src="safe-resource\/images\/demo.png"/);
});
test('heading suffixes do not collide with literal heading names', () => {
  const result = renderMarkdown('# Hello\n# Hello-1\n# Hello');
  assert.deepEqual(result.outline.map(h => h.id), ['hello', 'hello-1', 'hello-2']);
});
