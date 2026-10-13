const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { instrument, sources } = require('../scripts/coverage-instrument.cjs');
const { merge, summarize, check } = require('../scripts/coverage-policy.cjs');
test('untouched executable module remains uncovered and declarations are excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-fixture-'));
  try {
    const untouched = path.join(dir, 'untouched.ts');
    fs.writeFileSync(untouched, 'export function untouched(value: boolean) { return value ? 1 : 0; }');
    fs.writeFileSync(path.join(dir, 'types.d.ts'), 'export declare const declared: number;');
    fs.writeFileSync(path.join(dir, 'types.ts'), 'export interface TypesOnly {value: boolean}');
    assert.deepEqual(sources(dir), [untouched]);
    const seeded = merge({ [untouched]: instrument(untouched).coverage }, [])
      .fileCoverageFor(untouched)
      .toSummary();
    assert.equal(seeded.statements.pct, 0);
    assert.equal(seeded.functions.pct, 0);
    assert.equal(seeded.branches.pct, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('VM counters retain original TypeScript locations and regression fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-map-'));
  try {
    const file = path.join(dir, 'original.ts');
    fs.writeFileSync(
      file,
      'interface OnlyTypes { value: boolean }\nexport function choose(value: boolean) {\n  return value ? 1 : 0;\n}\n',
    );
    const result = instrument(file),
      counters = {};
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(result.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, __coverage__: counters },
    );
    assert.equal(exports.choose(true), 1);
    const covered = merge({ [file]: result.coverage }, [counters]);
    const fc = covered.fileCoverageFor(file);
    assert.equal(Object.values(fc.statementMap).find((location) => location.start.line === 3).start.line, 3);
    assert.ok(result.map.sourcesContent[0].includes('interface OnlyTypes'));
    const good = summarize(covered),
      bad = summarize(merge({ [file]: result.coverage }, []));
    assert.ok(check(bad, good).some((message) => message.includes('functions')));
    assert.ok(check({}, good).some((message) => message.includes('Missing module')));
    assert.ok(
      check(good, good, [
        {
          module: 'original.ts',
          metric: 'lines',
          minimum: 0,
          reason: 'fixture',
          owner: 'fixture',
          issue: 'fixture',
          expires: '2000-01-01',
        },
      ]).some((message) => message.includes('expired')),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('instrumented esbuild bundle preserves original source content and mapped lines', async () => {
  const esbuild = await import('esbuild');
  const { SourceMap } = require('node:module');
  const file = path.resolve(__dirname, '../src/async.ts');
  const original = fs.readFileSync(file, 'utf8');
  const result = instrument(file);
  const built = await esbuild.transform(
    result.code +
      '\n//# sourceMappingURL=data:application/json;base64,' +
      Buffer.from(JSON.stringify(result.map)).toString('base64'),
    { loader: 'ts', sourcemap: 'external', sourcefile: file },
  );
  const payload = JSON.parse(built.map);
  assert.ok(payload.sourcesContent.includes(original));
  const lines = built.code.split('\n');
  const line = lines.findIndex((text) => text.includes('console.error('));
  const mapped = new SourceMap(payload).findEntry(line, lines[line].indexOf('console.error'));
  assert.equal(
    mapped.originalLine,
    original.split('\n').findIndex((text) => text.includes('console.error(')),
  );
});
test('stale or vendor counters cannot be silently merged', () => {
  const file = path.resolve(__dirname, '../src/async.ts');
  const seed = { [file]: instrument(file).coverage };
  assert.throws(() => merge(seed, [{ 'node_modules/vendor.js': seed[file] }]), /outside first-party/);
  const incompatible = JSON.parse(JSON.stringify(seed));
  incompatible[file].statementMap['0'].start.line++;
  assert.throws(() => merge(seed, [incompatible]), /Incompatible coverage/);
});

test('negative regression fixture fails the coverage command with exit code 1', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-ratchet-'));
  try {
    const file = path.resolve(__dirname, '../src/async.ts');
    const uncovered = summarize(merge({ [file]: instrument(file).coverage }, []));
    const baseline = JSON.parse(JSON.stringify(uncovered));
    baseline['async.ts'].lines.pct = 100;
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(uncovered));
    fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(baseline));
    const run = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../scripts/coverage-check.cjs'),
        path.join(dir, 'summary.json'),
        path.join(dir, 'baseline.json'),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /async.ts lines: 0% < 100%/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('coverage instrumentation obeys production no-eval CSP', () => {
  const filename = require('node:path').resolve('src/render-limits.ts');
  const code = require('../scripts/coverage-instrument.cjs').instrument(filename).code;
  assert.doesNotMatch(code, /new Function|eval\(/);
  assert.match(code, /var global = globalThis/);
});
