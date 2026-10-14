const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const runtime = require('../.github/release-runtime.cjs');
const { hash } = require('../scripts/release-policy.cjs');
const root = path.resolve(__dirname, '..');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of [
    'gate-evidence.json',
    'vsix-inventory.json',
    'package-lock.json',
    'runtime-dependencies.json',
    'sbom.cdx.json',
    'toolchain.json',
  ])
    fs.writeFileSync(path.join(directory, name), '{}');
  fs.writeFileSync(path.join(directory, 'candidate.vsix'), 'never uploaded fixture');
  const files = fs.readdirSync(directory).map((name) => {
    const data = fs.readFileSync(path.join(directory, name));
    return { name, bytes: data.length, sha256: hash(data) };
  });
  const p = {
    schema: 1,
    repository: 'kasunkv/rich-markdown-preview',
    branch: 'main',
    publisher: 'kasunkodagoda',
    name: 'rich-markdown-preview',
    commit: 'a'.repeat(40),
    version: '2.0.1',
    tag: 'v2.0.1',
    rehearsal: true,
    vsix: { name: 'candidate.vsix', sha256: files.find((f) => f.name === 'candidate.vsix').sha256 },
    files,
  };
  fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(p));
  return {
    directory,
    p,
    expected: {
      commit: p.commit,
      tag: p.tag,
      digest: p.vsix.sha256,
      provenanceDigest: hash(fs.readFileSync(path.join(directory, 'provenance.json'))),
    },
  };
}
test('embedded workflow and executable runtime are generated from reviewed source without drift', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-release-workflow.cjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    if (!['publish', 'github-release'].includes(name)) {
      assert.equal(job.permissions?.['id-token'], undefined);
      assert.ok(!JSON.stringify(job).includes('secrets.'));
    }
  }
  const publish = workflow.jobs.publish;
  assert.equal(publish.environment, 'marketplace-production');
  assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' });
  assert.match(publish.if, /MARKETPLACE_PUBLICATION_ENABLED/);
  for (const name of ['publish', 'github-release'])
    assert.ok(!workflow.jobs[name].steps.some((step) => step.uses?.startsWith('actions/checkout')));
  assert.deepEqual(workflow.jobs['github-release'].permissions, { contents: 'write' });
  const install = publish.steps.find((step) => step.run?.startsWith('npm ci'));
  assert.match(install.run, /--ignore-scripts/);
  assert.deepEqual(workflow.jobs['release-gate'].needs, ['candidate', 'compatibility']);
  assert.deepEqual(workflow.jobs.compatibility.strategy.matrix.version, ['1.95.0', 'stable', 'insiders']);
  const commands = workflow.jobs.candidate.steps.map((step) => step.run).filter(Boolean);
  assert.ok(commands.includes('npm run release:gates'));
  assert.deepEqual(require('../scripts/release-candidate.cjs').REQUIRED_GATES, [
    'check:quality',
    'check:dependencies',
    'test:coverage',
    'test:mutation',
    'test:browser:harness',
  ]);
  assert.equal(commands.filter((c) => c === 'node scripts/release-candidate.cjs pack').length, 1);
  assert.ok(!workflow.jobs.compatibility.steps.some((step) => /npm run (build|package)/.test(step.run || '')));
});
test('actual embedded runtime starts on stdin and fails closed without independent binding', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
  const code = workflow.jobs.publish.steps.find((step) => step.name === 'Verify immutable candidate').run;
  const source = code.split("node - <<'NODE'\n")[1].split('\nNODE')[0];
  const result = spawnSync(process.execPath, ['-'], {
    cwd: root,
    input: source,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_OPERATION: 'verify', CANDIDATE_DIGEST: '', PROVENANCE_DIGEST: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing independent binding/);
});
test('protected runtime verifies full evidence inventory and rejects tampering and rehearsal promotion', async (t) => {
  const value = fixture(t);
  assert.equal(runtime.verify(value.directory, value.expected).rehearsal, true);
  await assert.rejects(runtime.publish(value.p, value.directory, 'missing-tools', 'missing-receipt'), /not approved/);
  fs.appendFileSync(path.join(value.directory, 'candidate.vsix'), 'changed');
  assert.throws(() => runtime.verify(value.directory, value.expected), /hash mismatch/);
});
test('protected toolchain accepts only independently bound, hook-free exact locked VSCE manifests', (t) => {
  const value = fixture(t),
    directory = path.join(value.directory, 'tools');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(directory, 'package-lock.json'),
    JSON.stringify({ packages: { 'node_modules/@vscode/vsce': { version: '4.0.0' } } }),
  );
  const binding = ['package.json', 'package-lock.json'].map((name) => ({
    name,
    sha256: hash(fs.readFileSync(path.join(directory, name))),
  }));
  fs.writeFileSync(path.join(directory, 'binding.json'), JSON.stringify(binding));
  const expected = hash(fs.readFileSync(path.join(directory, 'binding.json')));
  runtime.verifyTools(directory, expected);
  fs.writeFileSync(path.join(directory, '.npmrc'), 'registry=https://invalid.example');
  assert.throws(() => runtime.verifyTools(directory, expected), /Unexpected toolchain/);
  fs.unlinkSync(path.join(directory, '.npmrc'));
  fs.writeFileSync(path.join(directory, 'package.json'), '{"scripts":{"postinstall":"must not run"}}');
  assert.throws(() => runtime.verifyTools(directory, expected), /hash mismatch/);
});
test('Marketplace inspection accepts only the exact distributed bytes and observed identity using fake services', async (t) => {
  const value = fixture(t),
    originalFetch = global.fetch;
  t.after(() => (global.fetch = originalFetch));
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    if (url.endsWith('/extensionquery'))
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              extensions: [
                {
                  publisher: { publisherName: value.p.publisher },
                  extensionName: value.p.name,
                  versions: [{ version: value.p.version }],
                },
              ],
            },
          ],
        }),
      };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(path.join(value.directory, 'candidate.vsix')) };
  };
  assert.equal((await runtime.inspect(value.p, value.directory)).sha256, value.p.vsix.sha256);
  assert.equal(calls, 2);
  fs.appendFileSync(path.join(value.directory, 'candidate.vsix'), 'different distributed bytes');
  await assert.rejects(runtime.inspect(value.p, value.directory), /differs/);
});
test('locked VSCE archive API packages without invoking prepublish or rebuilding', () => {
  const source = fs.readFileSync(require.resolve('@vscode/vsce/out/package'), 'utf8');
  const pack = source.slice(source.indexOf('async function pack('), source.indexOf('async function signPackage('));
  assert.ok(pack.includes('writeVsix'));
  assert.ok(!pack.includes('prepublish('));
  const candidate = fs.readFileSync(path.join(root, 'scripts/release-candidate.cjs'), 'utf8');
  assert.match(candidate, /\.pack\(/);
  assert.ok(!candidate.includes('.packageCommand('));
});

test('local rehearsal CLI selects the explicit unpublishable command and rejects ambiguous source SHA', () => {
  const result = spawnSync(process.execPath, ['scripts/release-candidate.cjs', 'local-context', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact reviewed main SHA/);
});

test('actual protected promotion reconciles duplicate and accepted-timeout without another upload or PAT fallback', async (t) => {
  const value = fixture(t),
    p = { ...value.p, rehearsal: false };
  const keys = [
    'RELEASE_MODE',
    'GITHUB_REF',
    'GITHUB_REF_PROTECTED',
    'GITHUB_REPOSITORY',
    'VSCE_PAT',
    'AZURE_CLIENT_SECRET',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
  });
  Object.assign(process.env, {
    RELEASE_MODE: 'publish',
    GITHUB_REF: 'refs/tags/v2.0.1',
    GITHUB_REF_PROTECTED: 'true',
    GITHUB_REPOSITORY: p.repository,
  });
  delete process.env.VSCE_PAT;
  delete process.env.AZURE_CLIENT_SECRET;
  const receipt = path.join(value.directory, 'receipt');
  let uploads = 0;
  const remote = { publisher: p.publisher, name: p.name, version: p.version, sha256: p.vsix.sha256, installable: true };
  await runtime.publish(p, value.directory, 'never-used-tool', receipt, {
    inspectRemote: async () => remote,
    upload: async () => uploads++,
  });
  assert.equal(uploads, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(receipt, 'marketplace.json'))).status, 'reconciled');
  const upload = async (options) => {
    uploads++;
    assert.deepEqual(options, { packagePath: [path.join(value.directory, 'candidate.vsix')], azureCredential: true });
    throw Error('fixture timeout after accepted upload');
  };
  await runtime.publish(p, value.directory, 'never-used-tool', receipt, {
    inspectRemote: async () => null,
    upload,
    reconcileRemote: async () => remote,
  });
  assert.equal(uploads, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(receipt, 'marketplace.json'))).status,
    'reconciled-after-upload-error',
  );
  await assert.rejects(
    runtime.publish(p, value.directory, 'never-used-tool', receipt, {
      inspectRemote: async () => null,
      upload,
      reconcileRemote: async () => {
        throw Error('not yet visible');
      },
    }),
    /uncertain/,
  );
  assert.equal(uploads, 2);
  process.env.VSCE_PAT = 'fixture-only-not-a-credential';
  await assert.rejects(
    runtime.publish(p, value.directory, 'never-used-tool', receipt, {
      inspectRemote: async () => {
        throw Error('must not inspect');
      },
    }),
    /fallback is forbidden/,
  );
  assert.equal(uploads, 2);
});

test('distribution reconciliation bounds transient failures and rejects invalid retry counts without a second upload', async () => {
  let attempts = 0,
    waits = 0;
  const remote = { sha256: 'fixture' };
  assert.equal(
    await runtime.reconcile({}, '', {
      inspectRemote: async () => {
        if (++attempts < 3) throw Error('transient fixture');
        return remote;
      },
      wait: async () => waits++,
    }),
    remote,
  );
  assert.equal(attempts, 3);
  assert.equal(waits, 2);
  await assert.rejects(runtime.reconcile({}, '', { attempts: 7 }), /retry bound/);
  attempts = 0;
  await assert.rejects(
    runtime.reconcile({}, '', {
      inspectRemote: async () => {
        attempts++;
        return null;
      },
      wait: async () => {},
      attempts: 2,
    }),
    /unconfirmed/,
  );
  assert.equal(attempts, 2);
});

test('GitHub metadata recovery accepts identical existing assets, rejects mismatches, and preserves the candidate directory', async (t) => {
  const value = fixture(t),
    p = { ...value.p, rehearsal: false };
  const originalFetch = global.fetch,
    savedRef = process.env.GITHUB_REF,
    savedToken = process.env.GH_TOKEN;
  t.after(() => {
    global.fetch = originalFetch;
    if (savedRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = savedRef;
    if (savedToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedToken;
  });
  process.env.GITHUB_REF = 'refs/tags/v2.0.1';
  process.env.GH_TOKEN = 'fixture-only-not-a-credential';
  const before = fs.readdirSync(value.directory).sort();
  let writes = 0,
    tampered = false;
  const names = ['candidate.vsix', 'SHA256SUMS.txt', 'provenance.json'];
  global.fetch = async (url, init = {}) => {
    assert.ok(url.startsWith('https://api.github.com/'));
    if (init.method) {
      writes++;
      throw Error('must not write existing identical assets');
    }
    if (url.includes('/tags/'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: p.tag,
          target_commitish: p.commit,
          draft: false,
          assets: names.map((name, id) => ({ name, id })),
        }),
      };
    const id = Number(url.split('/').pop()),
      name = names[id];
    return {
      ok: true,
      arrayBuffer: async () =>
        tampered
          ? Buffer.from('different fixture')
          : name === 'SHA256SUMS.txt'
            ? Buffer.from(`${p.vsix.sha256}  candidate.vsix\n`)
            : fs.readFileSync(path.join(value.directory, name)),
    };
  };
  await runtime.githubRelease(p, value.directory);
  assert.equal(writes, 0);
  assert.deepEqual(fs.readdirSync(value.directory).sort(), before);
  tampered = true;
  await assert.rejects(runtime.githubRelease(p, value.directory), /asset differs/);
  assert.equal(writes, 0);
});
