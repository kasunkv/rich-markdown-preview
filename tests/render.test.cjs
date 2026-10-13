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

test('tables retain alignment, column header semantics, and keyboard scroll regions inside lists', () => {
  const { html } = renderMarkdown('- Comparison:\n\n  | Left | Center | Right |\n  | :--- | :---: | ---: |\n  | **Alpha** | `Beta` | 2000 |');
  assert.match(html, /<li>[\s\S]*<div class="table-scroll" role="region"[^>]*tabindex="0"><table>/);
  assert.match(html, /<th style="text-align:left" scope="col">Left/);
  assert.match(html, /<th style="text-align:center" scope="col">Center/);
  assert.match(html, /<td style="text-align:right">2000/);
  assert.match(html, /<strong>Alpha<\/strong>/);
  assert.match(html, /<code>Beta<\/code>/);
  assert.match(html, /<\/table>\s*<\/div>\s*<\/li>/);
});
test('uses unique heading anchors and resolves local image resources', () => {
  const result = renderMarkdown('# Hello\n## Hello\n\n![demo](images/demo.png)', src => `safe-resource/${src}`);
  assert.deepEqual(result.outline.map(h => h.fragment), ['hello', 'hello-1']); assert.match(result.html, /src="safe-resource\/images\/demo.png"/);
});
test('heading suffixes do not collide with literal heading names', () => {
  const result = renderMarkdown('# Hello\n# Hello-1\n# Hello');
  assert.deepEqual(result.outline.map(h => h.fragment), ['hello', 'hello-1', 'hello-2']);
});
test('outline labels include recursive image alt text, formatted content, and line breaks while retaining anchor slugs', () => {
  const result = renderMarkdown('# ![Architecture](diagram.png)\n\n**Build** ![system *map*](map.png) [guide][docs] `v2`\ncontinues 🚀 onward\n---\n\n[docs]: /guide');
  assert.equal(result.outline[0].text, 'Architecture');
  assert.equal(result.outline[0].fragment, 'architecture');
  assert.equal(result.outline[1].text, 'Build system map guide v2 continues 🚀 onward');
  assert.equal(result.outline[1].fragment, 'build-system-map-guide-v2-continues-onward');
  assert.equal(result.outline[1].id, 'rmp-heading-build-system-map-guide-v2-continues-onward');
  assert.match(result.html, /<h1 id="rmp-heading-architecture" data-md-anchor="architecture"><img[^>]+alt="Architecture"/);
});
test('escaped and Unicode heading text remains readable and unnamed headings get a stable label without changing fallback anchors', () => {
  const source = '# Café \\*literal 日本語\n# ![](blank.png)\n# ![](blank.png)';
  const result = renderMarkdown(source);
  assert.equal(result.outline[0].text, 'Café *literal 日本語');
  assert.deepEqual(result.outline.slice(1).map(({ text, fragment }) => [text, fragment]), [
    ['Untitled section', 'section'],
    ['Untitled section', 'section-1'],
  ]);
  assert.deepEqual(renderMarkdown(source), result);
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

test('empty source, Unicode headings, formatted headings and document-local state render consistently', () => {
  assert.deepEqual(renderMarkdown(''),{html:'',outline:[],references:[]});
  const source='# 日本語 **Heading** `code`\n# !!!\n# !!!\n# 日本語 **Heading** `code`';
  const result=renderMarkdown(source);
  assert.deepEqual(result.outline.map(item=>item.fragment),['日本語-heading-code','section','section-1','日本語-heading-code-1']);
  assert.deepEqual(renderMarkdown(source),result);
});

test('links and images safely escape attribute text, preserve fragments and reject unsafe image schemes', () => {
  const result=renderMarkdown('[Section](#hello)\n\n![a \\"quoted\\" alt](photo.png "Title")\n\n![bad](javascript:alert(1))', src=>'resource?file='+src+'&safe="yes"');
  assert.match(result.html,/href="#hello"/); assert.match(result.html,/loading="lazy"/);
  assert.match(result.html,/&amp;safe=&quot;yes&quot;/); assert.match(result.html,/title="Title"/);
  assert.doesNotMatch(result.html,/<img[^>]+src="javascript:/);
});

test('all supported callouts render and inline marker text stays ordinary prose', () => {
  for(const marker of ['NOTE','TIP','IMPORTANT','WARNING','CAUTION']) {
    assert.match(renderMarkdown(`> [!${marker}]\n> Body`).html,new RegExp('markdown-alert-'+marker.toLowerCase()));
  }
  assert.doesNotMatch(renderMarkdown('> [!TIP] ordinary text').html,/markdown-alert/);
});

test('heading aliases isolate interface and footnote collisions with stable Unicode duplicates', () => {
  const source = '# Content\n# Style\n# Outline\n# App\n# Announcement\n# fn1\n# fnref1\n# rmp-ui-style\n# rmp-footnote-fn1\n# Café 日本語\n# Café 日本語\n# Café 日本語-1\n\nNote[^a] again[^a].\n\n[^a]: Note text.';
  const result = renderMarkdown(source);
  const ids = [...result.html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(result.outline.map(item => item.fragment), ['content','style','outline','app','announcement','fn1','fnref1','rmp-ui-style','rmp-footnote-fn1','café-日本語','café-日本語-1','café-日本語-1-1']);
  for (const item of result.outline) {
    assert.equal(item.id, 'rmp-heading-' + item.fragment);
    assert.ok(result.html.includes(`data-md-anchor="${item.fragment}"`));
  }
  assert.match(result.html, /id="rmp-footnote-fn1"/);
  assert.match(result.html, /id="rmp-footnote-fnref1:1"/);
  assert.deepEqual(renderMarkdown(source), result);
});

test('diagrams retain a named figure and keyboard source disclosure', () => {
  const { html } = renderMarkdown('```mermaid\ngraph TD; A-->B\n```');
  assert.match(html, /<figure class="diagram"[^>]*aria-label="Mermaid diagram"/);
  assert.match(html, /<figcaption class="diagram-label">/);
  assert.match(html, /<details class="diagram-source"><summary>Diagram source<\/summary>/);
  assert.match(html, /<pre class="mermaid-source" tabindex="0"/);
});
