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
  assert.deepEqual(finalCheck({ coverage: { [fc.path]: fc }, inventory: [fc.path], diff }), [
    'Changed statements large.ts: 0/1 < 95%',
  ]);
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
