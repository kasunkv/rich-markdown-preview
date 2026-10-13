const {test} = require('node:test');
const assert = require('node:assert/strict');
const {renderMarkdown} = require('../dist/render.cjs');

test('skill and article frontmatter render before the body without polluting the outline', () => {
  const {html, outline} = renderMarkdown('---\nname: example-skill\ndescription: >\n  A useful skill\n  with multiple lines.\ntags: [agents, writing]\nsettings:\n  enabled: true\n  retries: 3\n  empty: null\n---\n# Instructions\n\nBody text.');
  assert.ok(html.startsWith('<details class="frontmatter" open>'));
  for (const text of ['example-skill','A useful skill with multiple lines.','agents','writing','enabled','true','retries','3','null','View YAML source']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('</details>') < html.indexOf('<h1'));
  assert.deepEqual(outline, [{id:'rmp-heading-instructions', fragment:'instructions', text:'Instructions', level:1, sourceLine:11}]);
});

test('frontmatter handles BOM, CRLF, end delimiters, literal blocks, empty and metadata-only files', () => {
  const result = renderMarkdown('\uFEFF---\r\ntitle: Article\r\ndescription: |\r\n  First line\r\n  Second line\r\n...\r\n# Body');
  assert.match(result.html, /First line\nSecond line/);
  assert.equal(result.outline.length, 1);
  assert.match(renderMarkdown('---\n---').html, /No metadata fields/);
  assert.match(renderMarkdown('---\ntitle: Alone\n---').html, /Alone/);
});

test('frontmatter escapes keys, values and source, including Markdown and HTML', () => {
  const {html, outline} = renderMarkdown('---\n"<script>": "<img src=x onerror=alert(1)>"\ntitle: "# Fake heading"\nlink: "[click](javascript:alert(1))"\n---\n# Real heading');
  assert.doesNotMatch(html, /<script>|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/);
  assert.equal(outline.length, 1); assert.equal(outline[0].text, 'Real heading');
});

test('invalid YAML and non-mapping metadata keep escaped source and render the body', () => {
  for (const source of ['title: [broken', 'title: one\ntitle: two', '- one\n- two', 'just a scalar', 'title: !unknown value']) {
    const {html, outline} = renderMarkdown(`---\n${source}\n---\n# Body`);
    assert.match(html, /Could not read frontmatter fields/);
    assert.match(html, /frontmatter-source/);
    assert.equal(outline[0].text, 'Body');
  }
});

test('ordinary Markdown, later fences and unclosed frontmatter remain Markdown', () => {
  for (const source of ['# Title\n\n---\nname: example\n---', '---\nname: unfinished', '```yaml\n---\nname: example\n---\n```', '\n---\nname: example\n---']) {
    assert.doesNotMatch(renderMarkdown(source).html, /class="frontmatter"/);
  }
});

test('aliases and cyclic metadata terminate safely while retaining YAML source', () => {
  const {html} = renderMarkdown('---\nitem: &item\n  name: original\n  self: *item\ncopy: *item\n---\n# Body');
  assert.match(html, /Alias reference/);
  assert.match(html, /View YAML source/);
  assert.match(html, /<h1/);
});
