const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const YAML = require('yaml');
const { REQUIRED_JOBS, verifyPrGate } = require('../scripts/verify-pr-gate.cjs');

const passed = Object.fromEntries(REQUIRED_JOBS.map(job => [job, { result: 'success' }]));

test('the PR gate accepts only successful required dependencies', () => {
  assert.deepEqual(verifyPrGate(passed), REQUIRED_JOBS);
  for (const result of ['failure', 'skipped', 'cancelled', 'neutral']) {
    assert.throws(() => verifyPrGate({ ...passed, coverage: { result } }), /coverage:/);
  }
  assert.throws(() => verifyPrGate({ ...passed, extra: { result: 'skipped' } }), /extra: skipped/);
  const missing = { ...passed };
  delete missing.quality;
  assert.throws(() => verifyPrGate(missing), /quality: missing/);
});

test('the executable gate exits nonzero for a skipped job', () => {
  const script = path.join(__dirname, '../scripts/verify-pr-gate.cjs');
  const run = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PR_GATE_NEEDS: JSON.stringify({ ...passed, host: { result: 'skipped' } }) },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /host: skipped/);
});

test('required workflow covers docs and manifests without PR authority', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/quality.yml'), 'utf8'));
  assert.deepEqual(workflow.on.pull_request.branches, ['main', 'master']);
  assert.deepEqual(workflow.on.push.branches, ['main', 'master']);
  assert.deepEqual(workflow.on.merge_group.branches, ['main', 'master']);
  assert.equal(workflow.on.pull_request.paths, undefined);
  assert.equal(workflow.on.push.paths, undefined);
  assert.equal(workflow.on.merge_group.paths, undefined);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs['pr-gate'].if, '${{ always() }}');
  assert.deepEqual(workflow.jobs['pr-gate'].needs, REQUIRED_JOBS);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions, undefined);
    assert.ok(job['timeout-minutes'] > 0);
    for (const step of job.steps) {
      if (step.uses) {
        assert.match(step.uses, /^actions\/[\w-]+@[0-9a-f]{40}$/);
        if (step.uses.startsWith('actions/checkout@'))
          assert.equal(step.with['persist-credentials'], false);
      }
    }
  }
  const source = fs.readFileSync(path.join(__dirname, '../.github/workflows/quality.yml'), 'utf8');
  assert.doesNotMatch(source, /secrets\.|id-token:|pull_request_target:|workflow_run:|\bvsce publish\b/i);
});
