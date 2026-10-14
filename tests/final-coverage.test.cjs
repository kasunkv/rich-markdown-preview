const { test } = require('node:test');
const assert = require('node:assert/strict');
const { finalCheck, changedLines } = require('../scripts/final-coverage-policy.cjs');
const { classify, checkMutation } = require('../scripts/mutation-policy.cjs');
function fixture(name, size = 1) {
  const file = '/fixture/src/' + name;
  const coverage = { path: file, statementMap: {}, fnMap: {}, branchMap: {}, s: {}, f: {}, b: {} };
  for (let i = 0; i < size; i++) {
    const loc = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } };
    coverage.statementMap[i] = loc;
    coverage.s[i] = 1;
    coverage.fnMap[i] = { name: 'f' + i, decl: loc, loc, line: i + 1 };
    coverage.f[i] = 1;
    coverage.branchMap[i] = { type: 'if', loc, locations: [loc, loc], line: i + 1 };
    coverage.b[i] = [1, 1];
  }
  return coverage;
}
test('weak module fails despite high global totals and omitted inventory module fails', () => {
  const large = fixture('large.ts', 100),
    small = fixture('small.ts');
  small.f[0] = 0;
  const input = { coverage: { [large.path]: large, [small.path]: small }, inventory: [large.path, small.path] };
  assert.deepEqual(finalCheck(input), ['small.ts functions: 0% < 95%']);
  delete input.coverage[small.path];
  assert.ok(finalCheck(input).includes('Missing inventoried module: small.ts'));
});
test('actual diff added lines enforce changed statements above all aggregate floors', () => {
  const fc = fixture('large.ts', 100);
  fc.s[50] = 0;
  const diff =
    'diff --git a/src/large.ts b/src/large.ts\n--- a/src/large.ts\n+++ b/src/large.ts\n@@ -50,0 +51 @@\n+changed();\n';
  assert.deepEqual([...changedLines(diff)['src/large.ts']], [51]);
  assert.ok(
    finalCheck({ coverage: { [fc.path]: fc }, inventory: [fc.path], diff }).includes(
      'Changed statements large.ts: 0/1 < 95%',
    ),
  );
  assert.deepEqual([...changedLines('+++ b/src/x.ts\n@@ -3 +3,0 @@')['src/x.ts']], []);
});
test('reachable safety arms require full coverage with narrow current exceptions', () => {
  const fc = fixture('policy.ts', 100);
  fc.b[0][1] = 0;
  const input = {
    coverage: { [fc.path]: fc },
    inventory: [fc.path],
    safety: [{ module: 'policy.ts', branch: '0', location: fc.branchMap[0] }],
    now: new Date('2026-10-13'),
  };
  assert.match(finalCheck(input).join(), /Uncovered safety arm/);
  const exception = {
    module: 'policy.ts',
    branch: '0',
    arm: 1,
    kind: 'technically-unreachable',
    reason: 'runtime invariant proof',
    issue: 'review-1',
    owner: 'maintainer',
    expires: '2026-11-01',
  };
  assert.deepEqual(finalCheck({ ...input, exceptions: [exception] }), []);
  assert.match(finalCheck({ ...input, exceptions: [{ ...exception, expires: '2026-10-12' }] }).join(), /expired/);
  assert.match(finalCheck({ ...input, exceptions: [{ ...exception, expires: '2026-02-30' }] }).join(), /Invalid/);
  assert.match(finalCheck({ ...input, exceptions: [{ ...exception, arm: 2 }] }).join(), /outside branch/);
  assert.match(finalCheck({ ...input, safety: [{ ...input.safety[0], location: {} }] }).join(), /stale safety/);
});
test('compile failures never count as mutation kills and survival fails the ratchet', () => {
  assert.equal(classify({ status: 1, stdout: 'SyntaxError: broken' }), 'invalid');
  assert.equal(classify({ status: 1, stdout: "failureType: 'testCodeFailure'\ncode: 'ERR_ASSERTION'" }), 'killed');
  assert.equal(classify({ status: 0, stdout: '' }), 'survived');
  assert.match(
    checkMutation([{ id: 'csv', status: 'survived' }], { killed: ['csv'], minimum: 100 }).join(),
    /regression/,
  );
  assert.deepEqual(checkMutation([{ id: 'csv', status: 'killed' }], { killed: ['csv'], minimum: 100 }), []);
});

test('the changed-code gate consumes an actual Git zero-context source diff', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { instrument } = require('../scripts/coverage-instrument.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmp-diff-'));
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const file = path.join(dir, 'src', 'changed.ts');
    const source = Array.from({ length: 100 }, (_, i) => 'export const v' + i + ' = ' + i + ';').join('\n') + '\n';
    fs.writeFileSync(file, source);
    git(['init', '--quiet']);
    git(['add', 'src/changed.ts']);
    git([
      '-c',
      'user.name=Coverage fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'Fixture base',
    ]);
    fs.writeFileSync(file, source.replace('v50 = 50', 'v50 = -50'));
    const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', 'src']);
    assert.deepEqual([...changedLines(diff)['src/changed.ts']], [51]);
    const coverage = instrument(file).coverage;
    for (const id of Object.keys(coverage.s)) coverage.s[id] = coverage.statementMap[id].start.line === 51 ? 0 : 1;
    assert.match(
      finalCheck({ coverage: { [file]: coverage }, inventory: [file], diff }).join('\n'),
      /Changed statements changed.ts: 0\/1/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('required PR and full release paths enforce current source and mutation gates', () => {
  const YAML = require('yaml'),
    fs = require('node:fs'),
    path = require('node:path');
  const root = path.resolve(__dirname, '..'),
    manifest = require('../package.json');
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/quality.yml'), 'utf8'));
  const steps = workflow.jobs.coverage.steps;
  assert.ok(steps.some((step) => step.run === 'npm run test:coverage'));
  assert.ok(steps.some((step) => step.run === 'npm run test:mutation'));
  assert.equal(steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  assert.match(workflow.jobs.coverage.env.COVERAGE_BASE, /base\.sha.*merge_group\.base_sha.*before/);
  assert.match(manifest.scripts.validate, /test:coverage.*test:mutation/);
  assert.match(manifest.scripts['validate:release'], /npm run validate.*check:dependencies.*package/);
});
test('changed unexecuted functions and branch arms fail despite high module totals', () => {
  const fc = fixture('large.ts', 100);
  fc.f[50] = 0;
  fc.b[50][1] = 0;
  const diff = '+++ b/src/large.ts\n@@ -51 +51 @@\n+changed();';
  const failures = finalCheck({ coverage: { [fc.path]: fc }, inventory: [fc.path], diff });
  assert.ok(failures.includes('Changed functions large.ts: 0/1 < 95%'));
  assert.ok(failures.includes('Changed branches large.ts: 1/2 < 90%'));
  assert.ok(!failures.some((message) => message.startsWith('Global')));
});

test('reviewed source bindings accept Windows and Linux line endings but reject content changes', () => {
  const { sourceDigest } = require('../scripts/final-coverage-enforcement.cjs');
  const source = 'export const allowed = false;\n';
  assert.equal(sourceDigest(source), sourceDigest(source.replaceAll('\n', '\r\n')));
  assert.notEqual(sourceDigest(source), sourceDigest(source.replace('false', 'true')));
});

test('quoted diff paths remain included and header-like source text cannot redirect coverage', () => {
  const diff = '+++ "b/src/spaced file.ts"\n@@ -1 +1,2 @@\n+++ b/src/forged.ts\n+actual();';
  assert.deepEqual([...changedLines(diff)['src/spaced file.ts']], [1, 2]);
  assert.equal(changedLines(diff)['src/forged.ts'], undefined);
  assert.throws(() => changedLines('+++ "b/src/unsupported\\123.ts"'), /Unsupported quoted/);
});

test('duplicate portable coverage identities cannot hide a weak module', () => {
  const first = fixture('same.ts', 100),
    second = structuredClone(first);
  second.path = '/other/src/same.ts';
  assert.match(
    finalCheck({ coverage: { [first.path]: first, [second.path]: second }, inventory: [first.path] }).join(),
    /Duplicate module/,
  );
});

test('safety proof metadata requires concrete nonempty strings', () => {
  const fc = fixture('policy.ts', 100);
  fc.b[0][1] = 0;
  const input = {
    coverage: { [fc.path]: fc },
    inventory: [fc.path],
    safety: [{ module: 'policy.ts', branch: '0', location: fc.branchMap[0] }],
    now: new Date('2026-10-15'),
  };
  for (const key of ['reason', 'owner', 'issue']) {
    const proof = {
      module: 'policy.ts',
      branch: '0',
      arm: 1,
      kind: 'technically-unreachable',
      reason: 'Proof',
      owner: 'maintainer',
      issue: 'docs/proof.md',
      expires: '2026-11-14',
      [key]: {},
    };
    assert.match(finalCheck({ ...input, exceptions: [proof] }).join(), /Invalid or expired safety exception/);
  }
});

test('portable report paths still bind original function locations to current source', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { instrument } = require('../scripts/coverage-instrument.cjs');
  const { enforce, sourceDigest } = require('../scripts/final-coverage-enforcement.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmp-portable-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const file = path.join(dir, 'src', 'guarded.ts'),
      source = 'export function guarded(value: boolean) { if (value) return 1; return 0; }\n';
    fs.writeFileSync(file, source);
    const fc = structuredClone(instrument(file).coverage);
    for (const id of Object.keys(fc.s)) fc.s[id] = 1;
    for (const id of Object.keys(fc.f)) fc.f[id] = 1;
    for (const id of Object.keys(fc.b)) fc.b[id] = fc.b[id].map(() => 1);
    fs.writeFileSync(
      path.join(dir, 'safety-policy.json'),
      JSON.stringify({ completeModules: ['guarded.ts'], sourceHashes: { 'guarded.ts': sourceDigest(source) } }),
    );
    fs.writeFileSync(
      path.join(dir, 'safety-branches.json'),
      JSON.stringify(
        Object.entries(fc.branchMap).map(([branch, location]) => ({ module: 'guarded.ts', branch, location })),
      ),
    );
    fs.writeFileSync(path.join(dir, 'safety-exceptions.json'), '[]');
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
    fc.path = '/portable/src/guarded.ts';
    assert.deepEqual(enforce({ [fc.path]: fc }, dir, 'HEAD').failures, []);
    const functionId = Object.keys(fc.f)[0],
      functionCount = fc.f[functionId];
    delete fc.f[functionId];
    assert.throws(() => enforce({ [fc.path]: fc }, dir, 'HEAD'), /Missing or extra original TypeScript counters/);
    fc.f[functionId] = functionCount;
    const branchId = Object.keys(fc.b)[0],
      branchCounts = fc.b[branchId];
    fc.b[branchId] = [1];
    assert.throws(() => enforce({ [fc.path]: fc }, dir, 'HEAD'), /Invalid original TypeScript counters/);
    fc.b[branchId] = branchCounts;
    fc.fnMap[Object.keys(fc.fnMap)[0]].loc.start.line = 900;
    assert.throws(() => enforce({ [fc.path]: fc }, dir, 'HEAD'), /Stale original TypeScript locations/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
