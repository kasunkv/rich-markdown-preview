const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { merge, summarize, check } = require('./coverage-policy.cjs');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const root = path.resolve(__dirname, '..');
const run = path.join(
  root,
  '.test-results',
  'coverage',
  new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID(),
);
const host = path.join(run, 'host'),
  browser = path.join(run, 'browser');
fs.mkdirSync(host, { recursive: true });
fs.mkdirSync(browser, { recursive: true });
const startedAt = new Date().toISOString();
const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim());
const sourceHashes = Object.fromEntries(
  require('./coverage-instrument.cjs')
    .sources()
    .map((file) => [
      path.relative(root, file).replaceAll('\\', '/'),
      createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ]),
);
const env = { ...process.env, SOURCE_COVERAGE_ROOT: run };
let commandIndex = 0;
function execute(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...env, ...extra },
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  fs.writeFileSync(
    path.join(run, `command-${++commandIndex}.log`),
    [args.join(' '), result.stdout, result.stderr].join('\n'),
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Coverage command failed (${result.status}): ${args.join(' ')}`);
}
function readMaps(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
}
console.log('Source coverage evidence: ' + run);
let status = 'failed';
try {
  execute(['build.mjs', '--production']);
  execute(['--test', 'tests/package.test.cjs']);
  execute(['build.mjs', '--coverage']);
  fs.mkdirSync(path.join(run, 'maps'));
  for (const file of fs.readdirSync(path.join(root, 'dist')).filter((file) => file.endsWith('.map')))
    fs.copyFileSync(path.join(root, 'dist', file), path.join(run, 'maps', file));
  const tests = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((file) => file.endsWith('.test.cjs') && file !== 'package.test.cjs')
    .map((file) => 'tests/' + file);
  execute(['--require', './tests/coverage-preload.cjs', '--test', '--test-concurrency=2', ...tests], {
    SOURCE_COVERAGE_DIR: host,
  });
  execute(['--require', './tests/coverage-preload.cjs', 'scripts/browser-runner.cjs'], {
    SOURCE_COVERAGE_DIR: host,
    SOURCE_BROWSER_COVERAGE_DIR: browser,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require=' + JSON.stringify(path.join(root, 'tests', 'coverage-preload.cjs'))]
      .filter(Boolean)
      .join(' '),
  });
  const seed = JSON.parse(fs.readFileSync(path.join(run, 'inventory.json'), 'utf8'));
  const hostMaps = readMaps(host),
    browserMaps = readMaps(browser);
  if (!hostMaps.length || !browserMaps.length) throw new Error('Missing current-run host or browser contribution');
  const combined = merge(seed, [...hostMaps, ...browserMaps]);
  const summary = summarize(combined);
  const contributions = { host: summarize(merge(seed, hostMaps)), browser: summarize(merge(seed, browserMaps)) };
  fs.writeFileSync(path.join(run, 'contributions.json'), JSON.stringify(contributions, null, 2));
  fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify(summary, null, 2));
  const context = createContext({
    dir: run,
    coverageMap: combined,
    sourceFinder: (file) => fs.readFileSync(file, 'utf8'),
  });
  for (const name of ['html', 'lcovonly', 'json', 'json-summary', 'text']) reports.create(name).execute(context);
  const baselinePath = path.join(root, 'coverage-baseline.json');
  const updating = process.argv.includes('--update-baseline');
  const previous = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  // An explicit update may add modules or tighten floors, never shrink or lower inherited entries.
  const failures = check(
    summary,
    updating ? { ...summary, ...previous } : previous,
    updating ? [] : JSON.parse(fs.readFileSync(path.join(root, 'coverage-exceptions.json'), 'utf8')),
  );
  if (failures.length) {
    for (const [file, counters] of Object.entries(combined.toJSON())) {
      const name = path.relative(path.join(root, 'src'), file).replaceAll('\\', '/');
      if (!failures.some((failure) => failure.startsWith(name + ' functions:'))) continue;
      for (const [id, count] of Object.entries(counters.f)) {
        if (count) continue;
        const fn = counters.fnMap[id];
        console.error(`Uncovered function: ${name}:${fn.loc.start.line}:${fn.loc.start.column} (${fn.name})`);
      }
    }
    throw new Error(failures.join('\n'));
  }
  const finalGate = require('./final-coverage-enforcement.cjs').enforce(
    combined.toJSON(),
    root,
    process.env.COVERAGE_BASE,
  );
  fs.writeFileSync(path.join(run, 'final-gate.json'), JSON.stringify(finalGate, null, 2));
  if (finalGate.failures.length) throw new Error(finalGate.failures.join('\n'));
  if (updating) fs.writeFileSync(baselinePath, JSON.stringify(summary, null, 2) + '\n');
  status = 'passed';
} finally {
  fs.writeFileSync(
    path.join(run, 'run.json'),
    JSON.stringify(
      {
        status,
        startedAt,
        dirty,
        sourceHashes,
        commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  // Restore standard production bundles so a failed coverage run cannot affect later package checks.
  const restored = spawnSync(process.execPath, ['build.mjs', '--production'], { cwd: root, stdio: 'inherit' });
  if (restored.status !== 0) process.exitCode = 1;
}
