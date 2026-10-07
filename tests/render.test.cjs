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
test('task lists render accessible read-only checked and unchecked controls', () => {
  const { html } = renderMarkdown('- [ ] Pending **task**\n- [x] Done\n  - [X] Nested done\n\n- [ ] Loose task\n\n  A second paragraph.');
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4);
  assert.equal((html.match(/checked=""/g) || []).length, 2);
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
  assert.match(html, /<label><input/);
  assert.match(html, /<strong>task<\/strong>/);
  assert.match(html, /A second paragraph/);
});
test('checkbox-looking prose and code are not converted into task lists', () => {
  const { html } = renderMarkdown('[x] Ordinary paragraph\n\n- Not a task [x]\n\n```markdown\n- [ ] code task\n```');
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /\[ \] code task/);
});
test('emoji expands in prose, headings, tables, and task labels but preserves code and unknown shortcodes', () => {
  const result = renderMarkdown('# Launch :rocket:\n\n:smile: :warning: :does_not_exist: :+1:\n\n| Status |\n| --- |\n| :white_check_mark: |\n\n- [ ] Ship :rocket:\n\n`:rocket:`\n\n```text\n:smile:\n```');
  assert.match(result.html, /aria-label="rocket">🚀/);
  assert.match(result.html, /aria-label="smile">😄/);
  assert.match(result.html, /:does_not_exist:/);
  assert.match(result.html, /<code>:rocket:<\/code>/);
  assert.match(result.html, /<code class="hljs">:smile:/);
  assert.equal(result.outline[0].text, 'Launch 🚀');
});
test('footnotes, definition lists, highlights, subscript, and superscript render', () => {
  const { html } = renderMarkdown('A note.[^a]\n\n[^a]: Footnote text.\n\nTerm\n: Definition text.\n\n==Highlighted== H~2~O x^2^');
  assert.match(html, /class="footnote-ref"/); assert.match(html, /class="footnotes"/);
  assert.match(html, /<dl>/); assert.match(html, /<dt>Term<\/dt>/);
  assert.match(html, /<mark>Highlighted<\/mark>/); assert.match(html, /<sub>2<\/sub>/); assert.match(html, /<sup>2<\/sup>/);
});
test('callouts support known markers, nested content, and safe HTML without changing ordinary quotes', () => {
  const { html } = renderMarkdown('> [!TIP]\n> Use **bold** and :rocket:.\n>\n> - Nested list\n\n> Ordinary quote\n\n> [!UNKNOWN]\n> Leave this marker alone.\n\n> [!CAUTION]\n> <script>alert(1)</script>');
  assert.match(html, /markdown-alert-tip/); assert.match(html, /markdown-alert-caution/);
  assert.match(html, /<strong>bold<\/strong>/); assert.match(html, /Nested list/);
  assert.match(html, /\[!UNKNOWN\]/); assert.match(html, /<blockquote>\n<p>Ordinary quote/);
  assert.doesNotMatch(html, /<script>|\[!TIP\]/);
});
