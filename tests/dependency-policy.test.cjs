const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateRuntime, verifyRuntime, hash } = require('../scripts/dependency-policy.cjs');
const { evaluateAudit } = require('../scripts/audit-dependencies.cjs');

test('production input inventory includes new/nested packages, excludes tooling and requires complete reviewed license texts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dependency-policy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = { allowedLicenses: ['MIT'], exceptions: [] };
  const packages = {};
  for (const [directory, name] of [
    ['node_modules/new-runtime', 'new-runtime'],
    ['node_modules/parent/node_modules/nested', 'nested'],
    ['node_modules/build-only', 'build-only'],
  ]) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
    await fs.writeFile(
      path.join(root, directory, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
    );
    await fs.writeFile(path.join(root, directory, 'LICENSE'), `Copyright ${name}\nMIT license fixture\n`);
    packages[directory] = {
      version: '1.0.0',
      integrity: 'sha512-fixture',
      resolved: 'https://registry.npmjs.org/fixture',
    };
  }
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));
  await fs.mkdir(path.join(root, 'dist'));
  const bundles = ['dist/extension.js', 'dist/preview.js', 'dist/render.cjs', 'dist/diagrams.js'];
  for (const bundle of bundles) await fs.writeFile(path.join(root, bundle), 'production bundle fixture');
  const inputs = [
    'src/extension.ts',
    'node_modules/new-runtime/index.js',
    'node_modules/parent/node_modules/nested/index.js',
  ];
  const inventory = await generateRuntime(root, inputs, bundles, policy);
  assert.deepEqual(
    inventory.components.map((item) => item.name),
    ['new-runtime', 'nested'],
  );
  const entries = new Map(
    await Promise.all(
      [...bundles, 'THIRD_PARTY_NOTICES.txt', 'RUNTIME_DEPENDENCIES.json'].map(async (file) => [
        `extension/${file}`,
        { data: await fs.readFile(path.join(root, file)) },
      ]),
    ),
  );
  verifyRuntime(entries, entries.get('extension/RUNTIME_DEPENDENCIES.json').data);
  const notices = entries.get('extension/THIRD_PARTY_NOTICES.txt').data;
  assert.match(notices.toString(), /new-runtime 1.0.0/);
  entries.set('extension/THIRD_PARTY_NOTICES.txt', { data: Buffer.from('generic fallback') });
  assert.throws(() => verifyRuntime(entries), /notices hash mismatch/);
  entries.set('extension/THIRD_PARTY_NOTICES.txt', { data: notices });
  entries.set('extension/dist/preview.js', { data: Buffer.from('stale bundle') });
  assert.throws(() => verifyRuntime(entries), /bundle hash mismatch/);
  assert.throws(() => verifyRuntime(entries, Buffer.from('{}')), /differs from current/);
  await fs.unlink(path.join(root, 'node_modules/new-runtime/LICENSE'));
  await assert.rejects(generateRuntime(root, inputs, bundles, policy), /Missing required license text/);
  await fs.writeFile(path.join(root, 'node_modules/new-runtime/LICENSE'), '');
  await assert.rejects(generateRuntime(root, inputs, bundles, policy), /Missing required license text/);
  await fs.writeFile(path.join(root, 'node_modules/new-runtime/LICENSE'), 'complete license fixture');
  await fs.writeFile(
    path.join(root, 'node_modules/new-runtime/package.json'),
    JSON.stringify({ name: 'new-runtime', version: '1.0.0', license: 'GPL-3.0' }),
  );
  await assert.rejects(generateRuntime(root, inputs, bundles, policy), /License review required/);
  const reviewed = {
    package: 'new-runtime',
    version: '1.0.0',
    license: 'GPL-3.0',
    owner: 'fixture owner',
    rationale: 'Fixture explicit review',
    approvedBy: 'fixture reviewer',
    reviewUrl: 'https://example.com/review',
    expires: '2099-01-01',
  };
  await generateRuntime(root, inputs, bundles, { ...policy, exceptions: [reviewed] });
  await assert.rejects(
    generateRuntime(root, inputs, bundles, { ...policy, exceptions: [{ ...reviewed, expires: '2000-01-01' }] }),
    /Expired exception/,
  );
  await fs.writeFile(
    path.join(root, 'node_modules/new-runtime/package.json'),
    JSON.stringify({ name: 'new-runtime', version: '2.0.0', license: 'MIT' }),
  );
  await assert.rejects(generateRuntime(root, inputs, bundles, policy), /Lockfile mismatch/);
});

test('reviewed README license extraction is version and hash bound', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'license-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'node_modules/readme-license'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'node_modules/readme-license/package.json'),
    JSON.stringify({ name: 'readme-license', version: '1.0.0', license: 'MIT' }),
  );
  await fs.writeFile(
    path.join(root, 'node_modules/readme-license/README.md'),
    '# README\n## License\nComplete license fixture',
  );
  await fs.writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ packages: { 'node_modules/readme-license': { version: '1.0.0', integrity: 'sha512-fixture' } } }),
  );
  const policy = {
    allowedLicenses: ['MIT'],
    exceptions: [],
    textSources: [
      {
        package: 'readme-license',
        version: '1.0.0',
        file: 'README.md',
        after: '## License',
        sha256: hash('Complete license fixture'),
      },
    ],
  };
  assert.equal(
    (await generateRuntime(root, ['node_modules/readme-license/index.js'], [], policy)).components.length,
    1,
  );
  await fs.writeFile(path.join(root, 'node_modules/readme-license/README.md'), '# README\n## License\nIncomplete');
  await assert.rejects(
    generateRuntime(root, ['node_modules/readme-license/index.js'], [], policy),
    /Reviewed license text changed/,
  );
  await fs.writeFile(path.join(root, 'node_modules/readme-license/LICENSE'), 'Metadata license fixture');
  await fs.writeFile(
    path.join(root, 'node_modules/readme-license/package.json'),
    JSON.stringify({ name: 'readme-license', version: '1.0.0' }),
  );
  const licensePolicy = {
    allowedLicenses: ['MIT'],
    exceptions: [],
    licenseSources: [
      {
        package: 'readme-license',
        version: '1.0.0',
        file: 'LICENSE',
        license: 'MIT',
        sha256: hash('Metadata license fixture'),
      },
    ],
  };
  assert.equal(
    (await generateRuntime(root, ['node_modules/readme-license/index.js'], [], licensePolicy)).components[0].license,
    'MIT',
  );
  await fs.writeFile(path.join(root, 'node_modules/readme-license/LICENSE'), 'Changed metadata license fixture');
  await assert.rejects(
    generateRuntime(root, ['node_modules/readme-license/index.js'], [], licensePolicy),
    /Reviewed license metadata changed/,
  );
});

test('advisories fail high/critical, allow reviewed exceptions only until UTC expiry, and fail unavailable reports', () => {
  const advisory = { source: 123, severity: 'high', url: 'https://github.com/advisories/GHSA-fixture', range: '<2' };
  const report = {
    auditReportVersion: 2,
    vulnerabilities: { runtime: { severity: 'high', via: [advisory] }, parent: { severity: 'high', via: ['runtime'] } },
    metadata: { vulnerabilities: { high: 2 } },
  };
  assert.throws(() => evaluateAudit(report, { exceptions: [] }), /Dependency advisory gate failed/);
  const exception = {
    package: 'runtime',
    advisory: advisory.url,
    range: '<2',
    owner: 'maintainer',
    rationale: 'Fixture awaiting upstream fix',
    approvedBy: 'reviewer',
    reviewUrl: 'https://github.com/example/repo/pull/1',
    expires: '2026-11-01',
  };
  const now = new Date('2026-10-13T00:00:00Z');
  assert.deepEqual(evaluateAudit(report, { exceptions: [exception] }, now), { high: 2 });
  assert.throws(
    () => evaluateAudit(report, { exceptions: [exception] }, new Date('2026-11-01T00:00:00Z')),
    /Expired exception/,
  );
  for (const override of [
    { expires: 'invalid' },
    { expires: '2026-02-31' },
    { owner: '' },
    { approvedBy: '' },
    { reviewUrl: '' },
  ])
    assert.throws(
      () => evaluateAudit(report, { exceptions: [{ ...exception, ...override }] }, now),
      /exception|Exception/,
    );
  assert.throws(() => evaluateAudit(report, { exceptions: [{ ...exception, range: '<1' }] }, now), /gate failed/);
  const critical = structuredClone(report);
  critical.vulnerabilities.runtime.via[0].severity = 'critical';
  assert.throws(() => evaluateAudit(critical, { exceptions: [] }), /critical/);
  const moderate = structuredClone(report);
  moderate.vulnerabilities.runtime.via[0].severity = 'moderate';
  moderate.vulnerabilities.runtime.severity = 'moderate';
  moderate.vulnerabilities.parent.severity = 'moderate';
  assert.deepEqual(evaluateAudit(moderate, { exceptions: [] }), { high: 2 });
  for (const invalid of [{}, { ...report, error: { code: 'ENETWORK' } }, { ...report, auditReportVersion: 1 }])
    assert.throws(() => evaluateAudit(invalid, { exceptions: [] }), /Invalid or unavailable/);
  const cyclic = {
    ...report,
    vulnerabilities: { a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a'] } },
  };
  assert.throws(() => evaluateAudit(cyclic, { exceptions: [] }), /unrecognized high/);
  const malformed = structuredClone(report);
  malformed.vulnerabilities.runtime.via[0].severity = 'unknown';
  assert.throws(() => evaluateAudit(malformed, { exceptions: [] }), /Invalid source advisory/);
  const dangling = structuredClone(report);
  delete dangling.vulnerabilities.runtime;
  assert.throws(() => evaluateAudit(dangling, { exceptions: [] }), /Missing propagated/);
});

test('dependency update PRs use the required gate; maintenance keeps SHA-pinned Actions', async () => {
  const workflows = await Promise.all(
    ['quality.yml', 'dependencies.yml'].map((file) =>
      fs.readFile(path.join(__dirname, '../.github/workflows', file), 'utf8'),
    ),
  );
  assert.match(workflows[0], /pull_request:/);
  assert.match(workflows[1], /workflow_dispatch:/);
  assert.match(workflows[1], /schedule:/);
  for (const workflow of workflows) assert.doesNotMatch(workflow, /dependabot\[bot\]|pull_request_target/);
  assert.match(workflows[0], /npm run check:quality/);
  assert.match(workflows[0], /npm run check:dependencies/);
  assert.match(workflows[0], /npm run package/);
  assert.match(workflows[1], /npm run check:dependencies/);
  assert.match(workflows[1], /npm run package/);
  for (const action of workflows.join('\n').matchAll(/uses:\s*([^\s]+)/g)) assert.match(action[1], /@[0-9a-f]{40}$/);
  const updates = await fs.readFile(path.join(__dirname, '../.github/dependabot.yml'), 'utf8');
  assert.match(updates, /package-ecosystem: npm/);
  assert.match(updates, /package-ecosystem: github-actions/);
});

test('audit runner checks both scopes despite failure and removes stale evidence on registry errors', async (t) => {
  const { audit } = require('../scripts/audit-dependencies.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.writeFile(path.join(root, 'scripts/advisory-exceptions.json'), JSON.stringify({ exceptions: [] }));
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  const high = {
    ...clean,
    vulnerabilities: {
      foo: {
        severity: 'high',
        via: [{ source: 1, severity: 'high', url: 'https://github.com/advisories/fixture', range: '*' }],
      },
    },
  };
  const calls = [];
  const run = (executable, args) => {
    calls.push(args);
    return { status: calls.length === 1 ? 1 : 0, stdout: JSON.stringify(calls.length === 1 ? high : clean) };
  };
  await assert.rejects(audit(root, { run }), /full: Dependency advisory gate failed/);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].includes('--omit=dev'));
  assert.ok(calls[1].includes('--omit=dev'));
  const evidence = path.join(root, '.test-results/dependencies');
  const status = JSON.parse(await fs.readFile(path.join(evidence, 'status.json')));
  assert.equal(status.scopes.full.passed, false);
  assert.equal(status.scopes.runtime.passed, true);
  assert.ok(Number.isFinite(Date.parse(status.checkedAt)));
  await assert.rejects(
    audit(root, { run: () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'ENETWORK' } }) }) }),
    /Invalid or unavailable/,
  );
  await assert.rejects(
    audit(root, { run: () => ({ status: null, error: new Error('network unavailable') }) }),
    /network unavailable/,
  );
  await assert.rejects(fs.access(path.join(evidence, 'full-audit.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(evidence, 'runtime-audit.json')), { code: 'ENOENT' });
});
