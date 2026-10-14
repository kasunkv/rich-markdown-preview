const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSourceFragment, fragmentWarning } = require('../dist/fragment-navigation.cjs');

test('source headings share preview aliases and exact zero-based positions', () => {
  const source =
    '---\nname: example\n---\n\n# Caf\u00e9 \u65e5\u672c\u8a9e\n\n# Details\n# Details-1\n# Details\n\nImage *Architecture*\n---\n\n```md\n# Fenced\n```';
  assert.deepEqual(resolveSourceFragment(source, 'caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E'), {
    kind: 'heading',
    fragment: 'caf\u00e9-\u65e5\u672c\u8a9e',
    line: 4,
  });
  assert.equal(resolveSourceFragment(source, 'details-2').line, 8);
  assert.equal(resolveSourceFragment(source, 'image-architecture').line, 10);
  assert.equal(resolveSourceFragment(source, 'fenced').kind, 'missing');
  assert.equal(fragmentWarning(resolveSourceFragment(source, 'details')), undefined);
  assert.deepEqual(resolveSourceFragment('## ![Architecture](a.png)\n# :rocket: Launch', 'architecture'), {
    kind: 'heading',
    fragment: 'architecture',
    line: 0,
  });
  assert.equal(resolveSourceFragment('# :rocket: Launch', 'launch').line, 0);
});

test('missing, malformed and DocFX line fragments produce actionable outcomes', () => {
  assert.deepEqual(resolveSourceFragment('', ''), { kind: 'none' });
  assert.equal(fragmentWarning({ kind: 'none' }), undefined);
  for (const fragment of ['L1', 'L1-L3', 'L2-4', 'l8']) {
    assert.equal(resolveSourceFragment('# Example', fragment).kind, 'unsupported-line');
    assert.match(fragmentWarning(resolveSourceFragment('', fragment)), /Go to Line/);
  }
  assert.match(fragmentWarning(resolveSourceFragment('', '%ZZ')), /percent encoding/);
  for (const fragment of ['absent', 'rmp-heading-example', 'Lfoo', '%2520']) {
    assert.equal(resolveSourceFragment('# Example', fragment).kind, 'missing');
    assert.match(fragmentWarning(resolveSourceFragment('', fragment)), /not found/);
  }
});

test('preview overflow does not lose source heading intent or authorize resources during outline lookup',()=>{
 const {renderMarkdown,renderMarkdownOutline}=require('../dist/render.cjs');
 for(const source of ['| A |\n| --- |\n'+'| row |\n'.repeat(10000)+'\n# Target', '```mermaid\ngraph TD; A-->B\n```\n\n'.repeat(21)+'# Target', 'line\n'.repeat(25001)+'\n# Target', '![local](a.png) '.repeat(50001)+'\n\n# Target']) {
  assert.match(renderMarkdown(source).html,/role="alert"/);const result=resolveSourceFragment(source,'target');assert.equal(result.kind,'heading');assert.equal(source.split('\n')[result.line],'# Target');
 }
 const outline=renderMarkdownOutline('# ![Architecture](private.svg)\n\n```js\nconst value=1;\n```');assert.equal(outline[0].text,'Architecture');assert.equal(renderMarkdownOutline('x'.repeat(2000001)).length,0);
});
