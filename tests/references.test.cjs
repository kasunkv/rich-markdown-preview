const {test} = require('node:test');
const assert = require('node:assert/strict');
const {renderMarkdown} = require('../dist/render.cjs');

test('supported referencing dialects render clickable relationship icons', () => {
  const cases = [
    ['{{include: /snippets/resolve-target-project.md}}','Include directive','include','/snippets/resolve-target-project.md'],
    ['Read @references/guide.md.', 'Claude','import','references/guide.md'],
    ['@"references/My Guide.md"', 'Claude','import','references/My Guide.md'],
    ['[!INCLUDE [Guide](references/guide.md)]','DocFX','include','references/guide.md'],
    ['[!code-js[Example](scripts/example.js#L1-L5)]','DocFX code','include','scripts/example.js#L1-L5'],
    ['--8<-- "references/guide.md:1:5"','PyMdown','include','references/guide.md:1:5'],
    ['{% include guide.md %}','Jekyll','include','guide.md'],
    ['{% include_relative "guide.md" %}','Jekyll relative','include','guide.md'],
    ['{{ include "snippets/guide" }}','Retype','include','snippets/guide'],
    ['[[Guide#Setup|Read guide]]','Obsidian','link','Guide#Setup'],
    ['![[Guide]]','Obsidian','embed','Guide'],
    ['<!-- @include: snippets/guide.md{1-5} -->','Include comment','include','snippets/guide.md'],
    ['{!! snippets/guide.md !!}','Markdown Include','include','snippets/guide.md'],
    ['[Guide](snippets/guide.md ":include")','Docsify','include','snippets/guide.md'],
    ['[Reference](references/guide.md)','Markdown','link','references/guide.md']
  ];
  for (const [source,syntax,relationship,path] of cases) {
    const result = renderMarkdown(source);
    assert.equal(result.references.length, 1, source);
    assert.equal(result.references[0].syntax, syntax, source);
    assert.equal(result.references[0].relationship, relationship, source);
    assert.equal(result.references[0].path, path, source);
    assert.match(result.html, /data-reference-id="reference-0"/);
    assert.match(result.html, /reference-icon/);
    assert.ok(result.html.includes(`reference-${relationship}`));
  }
});

test('PyMdown block includes support multiple files, lists and disabled entries', () => {
  const source = '--8<--\nfirst.md\n;disabled.md\nsecond.md\n--8<--\n\n- Nested:\n\n  --8<-- "third.md"';
  assert.deepEqual(renderMarkdown(source).references.map(ref => ref.path), ['first.md','second.md','third.md']);
});

test('code, escaped directives, frontmatter, email and ordinary mentions remain literal', () => {
  for (const source of ['`{{include: file.md}}`', '```md\n@file.md\n{{include: file.md}}\n```', '    --8<-- "file.md"', '\\@file.md', 'Hello @alice and user@example.com', '---\ninclude: "{{include: file.md}}"\n---\n# Body', '[Mention @file.md](https://example.com)']) {
    assert.equal(renderMarkdown(source).references.length, 0, source);
  }
});

test('unsafe schemes and dynamic templates are not made executable', () => {
  for (const source of ['{{include: javascript:alert(1)}}','{{include: command:workbench.action.closeWindow}}','{{include: //example.com/file.md}}','{% include {{page.target}} %}','@${CLAUDE_SKILL_DIR}/file.md']) {
    assert.equal(renderMarkdown(source).references.length, 0, source);
  }
  const result = renderMarkdown('{{include: "file & name.md"}}');
  assert.match(result.html, /file &amp; name.md/);
  assert.doesNotMatch(result.html, /onclick=/);
});

test('heading navigation and external links keep their existing behavior', () => {
  const result = renderMarkdown('[Section](#section) [Web](https://example.com) [Mail](mailto:a@example.com)');
  assert.equal(result.references.length, 0);
  assert.match(result.html, /href="#section"/);
  assert.match(result.html, /href="https:\/\/example.com"/);
});

test('reference labels remain in the outline and unsupported snippet targets stay visible', () => {
  const result = renderMarkdown('# [[Guide|Guide title]]\n\n--8<-- "${dynamic}/snippet.md"');
  assert.equal(result.outline[0].text, 'Guide title');
  assert.equal(result.outline[0].fragment, 'guide-title');
  assert.match(result.html, /\$\{dynamic\}\/snippet.md/);
  assert.equal(result.references.length, 1);
});

// Resolution candidates are URI-relative; these fixtures preserve each dialect's public root contract.
test('reference candidate dialects retain root fallbacks and filename URL suffix boundaries',()=>{
 const ts=require('typescript'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');function load(name){const filename=path.resolve('src/'+name+'.ts');const source=process.env.SOURCE_COVERAGE_ROOT?require('../scripts/coverage-instrument.cjs').instrument(filename).code:fs.readFileSync(filename,'utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:name=>load(name.slice(2)),__coverage__:globalThis.__coverage__??={}});return m.exports;}const m={exports:load('references')};
 const paths=(syntax,path)=>Array.from(m.exports.referencePaths({syntax,path}));
 assert.deepEqual(paths('Jekyll','guide.md#details'),['/_includes/guide.md']);
 assert.deepEqual(paths('Retype','guide'),['guide','guide.md','_includes/guide','_includes/guide.md','/_includes/guide','/_includes/guide.md']);
 assert.deepEqual(paths('Retype','guide.md'),['guide.md','_includes/guide.md','/_includes/guide.md']);
 assert.deepEqual(paths('Obsidian','guide'),['guide.md','/guide.md']);assert.deepEqual(paths('Obsidian','guide.md'),['guide.md','/guide.md']);
 assert.deepEqual(paths('PyMdown','guide.md:1,3-5'),['guide.md']);assert.deepEqual(paths('Markdown','file%23name.md?view=1#details'),['file%23name.md']);
});

test('empty, malformed and unsupported provider directives remain literal without privileged targets',()=>{
 for(const source of ['{{include: }}','{{include: bad<name>.md}}','--8<--\nmissing-close.md','--8<-- "readonly://authority/private.md"','@""','[!INCLUDE [](command:bad)]'])assert.equal(renderMarkdown(source).references.length,0,source);
 const result=renderMarkdown('Paragraph before snippet\n\n--8<--\none.md\n\n;disabled.md\n--8<--');assert.deepEqual(result.references.map(reference=>reference.path),['one.md']);
});
