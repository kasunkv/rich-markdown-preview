const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, boundRenderedModel } = require('../dist/render.cjs');
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

test('final async resource-expanded model is rechecked before host publication', () => {
  const initial = renderMarkdown('# Safe\n\n![local](local.png)');
  const final = boundRenderedModel({ ...initial, html: 'x'.repeat(32 * 1024 * 1024 + 1) });
  assert.match(final.html, /rendered content.*supported/);
  assert.deepEqual(final.outline, []);
  assert.deepEqual(final.references, []);
  assert.deepEqual(final.externalImageOrigins, []);
});
test('internal diagram kernel URLs reject direct and supported escape spellings before rendering', () => {
  const slash=String.fromCharCode(92);
  const host='file+.vscode-resource.vscode-cdn.net';
  for(const value of [host,host.toUpperCase(),host.replace('vscode',slash+'u0076scode'),host.replace('vscode',slash+'U00000076scode'),host.replace('vscode',slash+'u{76}scode'),host.replace('vscode',slash+'76 scode'),host.replace('vscode','&#118;scode'),host.replace('vscode','%76scode'),host.replace('vscode','%2576scode'),host.replace('vscode','v'+slash+'\nscode'), 'file+.vscode'+slash+'-resource.vscode-cdn.net']) {
    const result=renderMarkdown('```mermaid\nflowchart TD\nA@{img:"https://'+value+'/root/image.svg",h:20} --> B[Valid graph]\n```');
    assert.match(result.html,/unsupported internal preview resource/);assert.doesNotMatch(result.html,/mermaid-source/);
  }
  for(const value of ['vscode-resource:/root/image.svg','vscode-webview-resource:/root/image.svg','vscode-webview:/root/image.svg','https://example.test/%FF','https://example.test/'+slash+'110000vscode-resource.vscode-cdn.net','https://example.test/%25'+'25'.repeat(10)+'76']) {
    const result=renderMarkdown('```mermaid\nflowchart TD\nA@{img:"'+value+'",h:20}\n```');assert.match(result.html,/unsupported internal preview resource/);
  }
  assert.match(renderMarkdown('```mermaid\nflowchart TD\nA[50% ordinary graph] --> B[Safe]\n```').html,/mermaid-source/);
});
