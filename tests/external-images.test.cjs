const { test } = require('node:test');
const assert = require('node:assert/strict');
const moduleObject = { exports: require('./load-external-images.cjs') };
const { externalImageGrantsKey, externalImageOrigin, isExternalImageOrigin, readExternalImageGrants,
  externalImageDecision, externalImageCspOrigins } = moduleObject.exports;

test('only unambiguous HTTPS URLs and canonical origins can authorize images', () => {
  assert.match(externalImageGrantsKey, /v1$/);
  assert.equal(externalImageOrigin('HTTPS://EXAMPLE.com:443/path?q=1#part'), 'https://example.com');
  assert.equal(externalImageOrigin('https://example.com:8443/a.png'), 'https://example.com:8443');
  assert.equal(externalImageOrigin('https://[::1]/a'), 'https://[::1]');
  for (const value of [undefined, {}, '', 'http://example.com/a', '//example.com/a', 'https://',
    'https://user:pass@example.com/a', 'https://user@example.com', 'https://a\\b/image',
    'https://example.com/a b', 'https://example.com/\nimage', 'https://example.com/' + 'x'.repeat(8192)]) {
    assert.equal(externalImageOrigin(value), undefined, String(value).slice(0, 80));
    assert.equal(isExternalImageOrigin(value), false);
  }
  for (const value of ['https://example.com/', 'https://example.com/a', 'HTTPS://EXAMPLE.COM', 'https://example.com:443', '*', 'https:'])
    assert.equal(isExternalImageOrigin(value), false);
  assert.equal(isExternalImageOrigin('https://example.com'), true);
});

test('persisted grants sanitize corrupt values; default block, grant, revoke and trust hook fail closed', () => {
  assert.equal(readExternalImageGrants(undefined).size, 0);
  assert.equal(readExternalImageGrants({ origins: ['https://example.com'] }).size, 0);
  const grants = readExternalImageGrants(['https://example.com', 'https://example.com', 'http://evil.test', '*', null]);
  assert.equal(grants.size, 1);
  for (const local of ['a.png', '../a.png', 'file:///a.png', 'data:image/png;base64,eA=='])
    assert.equal(externalImageDecision(local, grants).kind, 'local');
  for (const remote of ['http://example.com/a', '//example.com/a', 'https://u:p@example.com/a', 'https://'])
    assert.equal(externalImageDecision(remote, grants).kind, 'blocked');
  assert.equal(externalImageDecision('https://other.test/a', grants).kind, 'blocked');
  assert.equal(externalImageDecision('https://example.com/a', grants).kind, 'allowed');
  assert.equal(externalImageDecision('https://example.com/another-document.png', grants).kind, 'allowed');
  assert.equal(externalImageDecision('https://example.com:8443/a', grants).kind, 'blocked');
  assert.equal(externalImageDecision('https://example.com/a', grants, false).kind, 'blocked');
  grants.delete('https://example.com');
  assert.equal(externalImageDecision('https://example.com/a', grants).kind, 'blocked');
  assert.equal(externalImageCspOrigins(grants), '');
  grants.add('https://z.test'); grants.add('https://a.test'); grants.add('https:');
  assert.equal(externalImageCspOrigins(grants), 'https://a.test https://z.test');
  assert.equal(externalImageCspOrigins(grants, false), '');
});

test('external images default to accessible blocked actions and exact render origin allowlist', () => {
  const { renderMarkdown } = require('../dist/render.cjs');
  const source = '# ![Map](https://example.com/a.png)\n![Second](https://example.com/b.png)\n![Other](https://other.test/a)\n![HTTP](http://example.com/a)\n![Local](a.png)';
  const blocked = renderMarkdown(source, (src) => '/local/' + src);
  assert.deepEqual(blocked.externalImageOrigins, ['https://example.com', 'https://other.test']);
  assert.doesNotMatch(blocked.html, /src="https?:/);
  assert.match(blocked.html, /external image blocked/);
  assert.match(blocked.html, /data-external-image-action="grant"/);
  assert.match(blocked.html, /src="\/local\/a.png"/);
  assert.equal(blocked.outline[0].text, 'Map');
  const allowed = renderMarkdown(source, (src) => '/local/' + src, { grants: new Set(['https://example.com']) });
  assert.match(allowed.html, /src="https:\/\/example.com\/a.png"[^>]*referrerpolicy="no-referrer"/);
  assert.match(allowed.html, /data-external-image-action="revoke"/);
  assert.doesNotMatch(allowed.html, /src="https:\/\/other.test/);
  assert.doesNotMatch(renderMarkdown(source, undefined, { grants: new Set(['https://example.com']), enabled: false }).html, /src="https:/);
  assert.doesNotMatch(renderMarkdown('![Empty]()').html, /https:/);
});

test('host permission adapter requires native confirmation and current rendered-origin authorization', async () => {
  const { ExternalImagePermissions } = moduleObject.exports;
  let stored;
  let writes = 0;
  let confirms = 0;
  const policy = new ExternalImagePermissions({ get: () => stored, update: async (key, value) => { writes++; stored = value; } });
  const accept = async () => { confirms++; return true; };
  assert.equal(await policy.change('grant', 'https://forged.test', () => false, accept), false);
  assert.equal(await policy.change('grant', 'https://example.com/', () => true, accept), false);
  assert.equal(await policy.change('grant', 'https://example.com', () => true, async () => false), false);
  assert.equal(writes, 0); assert.equal(confirms, 0);
  let current = true;
  assert.equal(await policy.change('grant', 'https://example.com', () => current, async () => { current = false; return true; }), false);
  assert.equal(writes, 0);
  await Promise.all(['https://example.com', 'https://other.test'].map(origin => policy.change('grant', origin, () => true, accept)));
  assert.equal(policy.grants.size, 2); assert.equal(writes, 2); assert.equal(confirms, 2);
  const reopened = new ExternalImagePermissions({ get: () => stored, update: async () => {} });
  assert.equal(reopened.grants.size, 2);
  assert.equal(await policy.change('revoke', 'https://example.com', () => true, accept), true);
  assert.equal(policy.grants.has('https://example.com'), false); assert.equal(confirms, 2);
  let fail = true;
  const faulty = new ExternalImagePermissions({ get: () => [], update: async () => { if (fail) throw Error('persist failed'); } });
  await assert.rejects(faulty.change('grant', 'https://example.com', () => true, accept), /persist failed/);
  assert.equal(faulty.grants.size, 0);
  fail = false;
  assert.equal(await faulty.change('grant', 'https://example.com', () => true, accept), true);
});

test('blocked image alternatives retain readable fallback and escaped origin actions', () => {
  const { renderMarkdown } = require('../dist/render.cjs');
  assert.match(renderMarkdown('![](https://example.com/empty.png)').html, /Image: external image blocked/);
  assert.match(renderMarkdown('![**Formatted**](https://example.com/a.png)').html, /Formatted: external image blocked/);
});

test('failed revocation denies immediately while failed grant never authorizes', async () => {
  const { ExternalImagePermissions } = moduleObject.exports;
  let policy;
  let stopped = false;
  policy = new ExternalImagePermissions({
    get: () => ['https://example.com'],
    update: async () => {
      assert.equal(policy.grants.has('https://example.com'), false);
      assert.equal(stopped, true);
      throw Error('user state read-only');
    },
  }, () => { stopped = externalImageDecision('https://example.com/image', policy.grants).kind === 'blocked'; });
  await assert.rejects(policy.change('revoke', 'https://example.com', () => true, async () => true), /read-only/);
  assert.equal(policy.grants.has('https://example.com'), false);
  assert.equal(externalImageCspOrigins(policy.grants), '');
});

test('wildcards and CSP delimiters cannot widen concrete HTTPS origins', () => {
  for (const value of ['https://*', 'https://*.example.com', "https://example.com;", "https://exa'mple.com", 'https://exa_mple.com', 'https://example.com\t', 'https://' + 'x'.repeat(64) + '.test']) {
    assert.equal(externalImageOrigin(value), undefined, value);
    assert.equal(isExternalImageOrigin(value), false, value);
  }
  assert.equal(externalImageOrigin('https://münich.example/a'), 'https://xn--mnich-kva.example');
  assert.equal(externalImageCspOrigins(new Set(['https://*', 'https://*.example.com', 'https://example.com;'])), '');
});

test('revoke denies synchronously during an unrelated pending grant write', async () => {
  const { ExternalImagePermissions } = moduleObject.exports;
  let unblock;
  let writes = 0;
  const policy = new ExternalImagePermissions({ get: () => ['https://example.com'], update: async () => {
    if (++writes === 1) await new Promise(resolve => { unblock = resolve; });
  } });
  const pending = policy.change('grant', 'https://other.test', () => true, async () => true);
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  const revoke = policy.change('revoke', 'https://example.com', () => true, async () => true);
  assert.equal(policy.grants.has('https://example.com'), false);
  unblock(); await pending;
  assert.equal(policy.grants.has('https://example.com'), false);
  await revoke;
  assert.equal(policy.grants.has('https://example.com'), false);
});

test('a pending same-origin grant never overrides a later revoke', async () => {
  const { ExternalImagePermissions } = moduleObject.exports;
  let unblock;
  let writes = 0;
  const policy = new ExternalImagePermissions({ get: () => ['https://example.com'], update: async () => {
    if (++writes === 1) await new Promise(resolve => { unblock = resolve; });
  } });
  const pending = policy.change('grant', 'https://example.com', () => true, async () => true);
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  const revoke = policy.change('revoke', 'https://example.com', () => true, async () => true);
  unblock();
  assert.equal(await pending, false);
  assert.equal(policy.grants.has('https://example.com'), false);
  await revoke;
});

test('extra authority separators fail closed and stale queued grants never confirm', async () => {
  for (const value of ['https:///example.com/a', 'https:////example.com/a']) assert.equal(externalImageOrigin(value), undefined);
  const { ExternalImagePermissions } = moduleObject.exports;
  const policy = new ExternalImagePermissions({get: () => [], update: async () => {}});
  let current = true;
  const pending = policy.change('grant', 'https://example.com', () => current, async () => { throw Error('should not confirm stale request'); });
  current = false;
  assert.equal(await pending, false);
  await policy.change('revoke', 'https://example.com', () => true, async () => true);
  assert.equal(await policy.change('grant', 'https://example.com', () => true, async () => true), true);
  assert.equal(policy.grants.has('https://example.com'), true);
});

test('non-HTTPS remote schemes never reach image URI adaptation', () => {
  for (const source of ['ftp://example.com/image', 'mailto:remote@example.com', 'vscode-resource://example/image'])
    assert.equal(externalImageDecision(source, new Set()).kind, 'blocked');
  assert.equal(externalImageDecision('FILE:///a.png', new Set()).kind, 'local');
  assert.equal(externalImageDecision('DATA:image/png;base64,eA==', new Set()).kind, 'local');
});


test('empty userinfo markers are rejected while at-signs in paths remain legal', () => {
  for (const value of ['https://@example.com/a', 'https://:@example.com/a', 'https://%40example.com/a'])
    assert.equal(externalImageOrigin(value), undefined);
  assert.equal(externalImageOrigin('https://example.com/a@b.png'), 'https://example.com');
});


test('hostnames over the DNS length limit cannot authorize a CSP source', () => {
  const hostname = Array(4).fill('a'.repeat(63)).join('.');
  assert.equal(externalImageOrigin(`https://${hostname}/image.svg`), undefined);
});

test('browser-trimmed or backslash-normalized remote spellings never become local images', () => {
  for (const source of [' https://example.com/a', 'https://example.com/a ', '\thttps://example.com/a', '\\example.com\\a', 'local\nfile.png'])
    assert.equal(externalImageDecision(source, new Set()).kind, 'blocked');
  assert.equal(externalImageDecision('local%20file.png', new Set()).kind, 'local');
});

test('linked image permission actions remain outside author anchors', () => {
  const {renderMarkdown} = require('../dist/render.cjs');
  const source = '[before ![One](https://example.com/a) between ![Two](https://example.com/b) after](https://link.test)\n\n[Plain](https://link.test) ![Three](https://example.com/c)';
  for (const grants of [new Set(),new Set(['https://example.com'])]) {
    const html = renderMarkdown(source, undefined, {grants}).html;
    assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
    assert.match(html, /after<\/a><button/);
    assert.equal((html.match(/data-external-image-action=/g) ?? []).length, 3);
  }
});

test('effective change hook identifies confirmed persisted grants and immediate revocations', async () => {
  const {ExternalImagePermissions} = moduleObject.exports;
  const events = [];
  let fail = false;
  const policy = new ExternalImagePermissions({get: () => [], update: async () => {if (fail) throw Error('write failed');}}, (action, origin) => events.push({action,origin}));
  await policy.change('grant', 'https://example.com', () => true, async () => true);
  assert.deepEqual(events, [{action:'grant',origin:'https://example.com'}]);
  fail = true;
  await assert.rejects(policy.change('grant', 'https://other.test', () => true, async () => true), /failed/);
  assert.equal(events.length, 1);
  await assert.rejects(policy.change('revoke', 'https://example.com', () => true, async () => true), /failed/);
  assert.deepEqual(events.at(-1), {action:'revoke',origin:'https://example.com'});
});
