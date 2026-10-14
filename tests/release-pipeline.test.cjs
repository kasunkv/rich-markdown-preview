const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  POLICY,
  hash,
  releaseTag,
  validateContext,
  validateSource,
  verifyCandidate,
} = require('../scripts/release-policy.cjs');
const { promote, reconcile } = require('../scripts/release-recovery.cjs');
const commit = 'a'.repeat(40);
const context = () => ({
  repository: POLICY.repository,
  eventName: 'push',
  tag: 'v2.0.1',
  ref: 'refs/tags/v2.0.1',
  refProtected: true,
  commit,
});
const source = () => ({
  context: context(),
  manifest: { ...POLICY, version: '2.0.1' },
  lock: { name: POLICY.name, version: '2.0.1', packages: { '': { name: POLICY.name, version: '2.0.1' } } },
  changelog: '## 2.0.1\n\nReviewed fixes.\n',
});
test('release refs reject injection, nonstable versions, fork events and unapproved manual refs', () => {
  for (const tag of ['v02.0.1', 'v2.0.1-beta', 'v2.0.1+build', 'v2.0.1\n', 'v2.0.1; echo nope', '--help', 'main'])
    assert.throws(() => releaseTag(tag));
  assert.equal(validateContext(context()), 'v2.0.1');
  for (const change of [
    { repository: 'fork/rich-markdown-preview' },
    { eventName: 'pull_request' },
    { eventName: 'pull_request_target' },
    { ref: 'refs/heads/main' },
    { refProtected: false },
    { manualTag: 'v2.0.2' },
    { commit: 'HEAD' },
  ])
    assert.throws(() => validateContext({ ...context(), ...change }));
  assert.equal(validateContext({ ...context(), eventName: 'workflow_dispatch', manualTag: 'v2.0.1' }), 'v2.0.1');
});
test('source release validates exact tag/checkout and ancestry using structured argv', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? commit : '';
  };
  assert.equal(validateSource(source(), git).branch, 'main');
  assert.deepEqual(calls[2], ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  for (const mutate of [
    (value) => (value.manifest.publisher = 'impostor'),
    (value) => (value.manifest.name = 'impostor'),
    (value) => (value.lock.version = '2.0.0'),
    (value) => (value.lock.packages[''].name = 'wrong'),
    (value) => (value.changelog = '## 2.0.1\n'),
    (value) => (value.manifest.version = '2.0.2'),
  ]) {
    const value = source();
    mutate(value);
    assert.throws(() => validateSource(value, git));
  }
  assert.throws(() => validateSource(source(), () => 'b'.repeat(40)), /commit mismatch/);
  assert.throws(
    () =>
      validateSource(source(), (args) => {
        if (args[0] === 'merge-base') throw new Error('not ancestor');
        return git(args);
      }),
    /not ancestor/,
  );
  assert.throws(
    () => validateSource(source(), (args) => (args[0] === 'status' ? ' M package.json' : git(args))),
    /clean/,
  );
});
function candidateFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-candidate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = Buffer.from('isolated fixture, never uploaded');
  const digest = hash(data);
  const name = 'rich-markdown-preview-2.0.1.vsix';
  fs.writeFileSync(path.join(directory, name), data);
  const provenance = {
    schema: 1,
    ...POLICY,
    commit,
    tag: 'v2.0.1',
    version: '2.0.1',
    vsix: { name, sha256: digest },
    files: [{ name, sha256: digest, bytes: data.length }],
  };
  const bytes = Buffer.from(JSON.stringify(provenance));
  fs.writeFileSync(path.join(directory, 'provenance.json'), bytes);
  return { directory, name, provenance, expected: { commit, tag: 'v2.0.1', digest, provenanceDigest: hash(bytes) } };
}
test('promotion refuses changed VSIX, changed provenance, extra files and self-supplied digest', (t) => {
  const value = candidateFixture(t);
  assert.equal(verifyCandidate(value.directory, value.expected).provenance.version, '2.0.1');
  assert.throws(() => verifyCandidate(value.directory, {}), /independently/);
  assert.throws(() => verifyCandidate(value.directory, { ...value.expected, digest: 'b'.repeat(64) }), /binding/);
  fs.writeFileSync(path.join(value.directory, value.name), 'tampered');
  assert.throws(() => verifyCandidate(value.directory, value.expected), /digest\/size/);
  fs.writeFileSync(path.join(value.directory, value.name), 'isolated fixture, never uploaded');
  fs.writeFileSync(path.join(value.directory, 'extra.cjs'), 'must never execute');
  assert.throws(() => verifyCandidate(value.directory, value.expected), /Unexpected/);
  fs.unlinkSync(path.join(value.directory, 'extra.cjs'));
  fs.appendFileSync(path.join(value.directory, 'provenance.json'), ' ');
  assert.throws(() => verifyCandidate(value.directory, value.expected), /provenance digest/);
});
test('provenance rejects origin, identity, unsafe paths and duplicate inventory even with independently supplied new digest', (t) => {
  const value = candidateFixture(t);
  for (const change of [
    (p) => (p.commit = 'b'.repeat(40)),
    (p) => (p.branch = 'master'),
    (p) => (p.publisher = 'wrong'),
    (p) => (p.version = '2.0.2'),
    (p) => p.files.push(p.files[0]),
    (p) => (p.files[0].name = '../escape.vsix'),
  ]) {
    const p = structuredClone(value.provenance);
    change(p);
    const bytes = Buffer.from(JSON.stringify(p));
    fs.writeFileSync(path.join(value.directory, 'provenance.json'), bytes);
    assert.throws(() => verifyCandidate(value.directory, { ...value.expected, provenanceDigest: hash(bytes) }));
  }
});
const remoteCandidate = { publisher: POLICY.publisher, name: POLICY.name, version: '2.0.1', sha256: 'a'.repeat(64) };
const distributed = { ...remoteCandidate, installable: true };
test('recovery reconciles identical duplicate and partial upload success without another upload', async () => {
  let uploads = 0;
  const existing = await promote(remoteCandidate, { inspect: async () => distributed, upload: async () => uploads++ });
  assert.equal(existing.status, 'reconciled');
  assert.equal(uploads, 0);
  let inspected = 0;
  const partial = await promote(remoteCandidate, {
    inspect: async () => (++inspected === 1 ? null : distributed),
    upload: async () => {
      uploads++;
      throw new Error('timeout after acceptance');
    },
  });
  assert.equal(partial.status, 'reconciled-after-upload-error');
  assert.equal(uploads, 1);
  await assert.rejects(
    promote(remoteCandidate, {
      inspect: async () => ({ ...distributed, sha256: 'b'.repeat(64) }),
      upload: async () => uploads++,
    }),
    /differs/,
  );
  assert.equal(uploads, 1);
});
test('recovery bounds distribution retries and leaves uncertain upload pending', async () => {
  let inspected = 0,
    uploads = 0;
  const transport = {
    inspect: async () => {
      inspected++;
      return null;
    },
    upload: async () => {
      uploads++;
      throw new Error('network unavailable');
    },
    wait: async () => {},
    attempts: 3,
  };
  await assert.rejects(promote(remoteCandidate, transport), /uncertain/);
  assert.equal(uploads, 1);
  assert.equal(inspected, 4);
  await assert.rejects(reconcile(remoteCandidate, { ...transport, attempts: 11 }), /bound/);
  await assert.rejects(
    reconcile(remoteCandidate, { inspect: async () => ({ ...distributed, installable: false }) }),
    /unverified/,
  );
  let reads = 0;
  assert.equal(
    (
      await promote(remoteCandidate, {
        inspect: async () => (++reads === 1 ? null : distributed),
        upload: async () => {},
        wait: async () => {},
      })
    ).status,
    'published',
  );
});
test('locked VSCE 4.0.0 OIDC protocol is measured with intercepted fake services only', async () => {
  const { getOIDCCredential } = require('@vscode/vsce/out/oidc');
  assert.equal(require('@vscode/vsce/package.json').version, '4.0.0');
  const calls = [];
  const credential = await getOIDCCredential(POLICY.publisher, {
    environment: {
      GITHUB_ACTIONS: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://github.invalid/token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-only',
    },
    marketplaceUrl: 'https://marketplace.invalid',
    request: async (url, request) => {
      calls.push({ url, request });
      return {
        statusCode: 200,
        readBody: async () =>
          JSON.stringify(calls.length === 1 ? { value: 'fixture-oidc' } : { credential: 'fixture-credential' }),
      };
    },
  });
  assert.equal(credential, 'fixture-credential');
  assert.equal(new URL(calls[0].url).searchParams.get('audience'), 'marketplace.visualstudio.com');
  assert.equal(calls[1].url, 'https://marketplace.invalid/_apis/gallery/token');
  assert.equal(calls[1].request.headers.Authorization, 'Bearer fixture-oidc');
  await assert.rejects(getOIDCCredential(POLICY.publisher, { environment: {} }), /No supported/);
});

test('sealing and tool preparation reject a checkout that changed after packaging', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-snapshot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const name of ['release-candidate.cjs', 'release-policy.cjs', 'release-version.cjs'])
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', name), path.join(dir, 'scripts', name));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: POLICY.name,
      publisher: POLICY.publisher,
      version: '2.0.1',
      scripts: { test: 'never execute' },
    }),
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  const { spawnSync } = require('node:child_process');
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'Fixture',
    ],
  ])
    assert.equal(spawnSync('git', args, { cwd: dir }).status, 0);
  const base = path.join(dir, '.test-results', 'release');
  fs.mkdirSync(base, { recursive: true });
  const startedAt = new Date().toISOString();
  fs.writeFileSync(path.join(base, 'context.json'), JSON.stringify({ commit: 'a'.repeat(40), startedAt }));
  fs.writeFileSync(
    path.join(base, 'commands.json'),
    JSON.stringify({ status: 'passed', commit: 'a'.repeat(40), startedAt, finishedAt: startedAt, commands: [] }),
  );
  for (const operation of ['tools', 'seal']) {
    const result = spawnSync(process.execPath, ['scripts/release-candidate.cjs', operation], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules') },
    });
    assert.notEqual(result.status, 0, operation + ' accepted an unrelated checkout');
    assert.match(result.stderr, /source snapshot changed/);
  }
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '\n.test-results/\n');
  const current = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(base, 'context.json'), JSON.stringify({ commit: current, startedAt }));
  const accepted = spawnSync(process.execPath, ['scripts/release-candidate.cjs', 'tools'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules') },
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'tools', 'package.json'))).scripts, undefined);
});
