const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { classify, checkMutation } = require('./mutation-policy.cjs');
const root = path.resolve(__dirname, '..');
const targets = [
  {
    id: 'scheme-denial',
    file: 'src/messages.ts',
    before: "if (!['https', 'http', 'mailto'].includes(scheme)) return false;",
    after: "if (!['https', 'http', 'mailto'].includes(scheme)) return true;",
    test: 'tests/messages.test.cjs',
    pattern: 'URI policy rejects decoded scheme and control-character bypasses',
  },
  {
    id: 'canonical-containment',
    file: 'src/resources.ts',
    before:
      "within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !statSync(canonicalTarget).isFile()",
    after: '!statSync(canonicalTarget).isFile()',
    test: 'tests/resources.test.cjs',
    pattern: 'workspace escape, symlink escape and unsupported providers fail closed; remote policy stays separate',
  },
  {
    id: 'csv-formula',
    file: 'src/tables.ts',
    before: "? `'\${value}` : value",
    after: '? value : value',
    test: 'tests/tables.test.cjs',
    pattern: 'CSV exports formula-like text as literal cells while keeping signed numbers',
    bundle: true,
  },
  {
    id: 'numeric-preference',
    file: 'src/messages.ts',
    before: 'value >= min && value <= max',
    after: 'value >= min',
    test: 'tests/messages.test.cjs',
    pattern: 'all command discriminants validate with bounded identities',
  },
  {
    id: 'async-generation',
    file: 'src/preview-session.ts',
    before: 'return !this.disposed && generation === this.generation;',
    after: 'return !this.disposed;',
    test: 'tests/preview-session.test.cjs',
    pattern: 'session guards parser/provider failures, stale results, timers and listener lifetime',
  },
  {
    id: 'preference-generation',
    file: 'src/preview-preferences.ts',
    before: 'generation !== this.generation',
    after: 'false',
    test: 'tests/preview-session.test.cjs',
    pattern: 'navigation clears failed and pending preference overrides for the next document',
  },
];
function execute(dir, args) {
  const env = { ...process.env };
  delete env.SOURCE_COVERAGE_ROOT;
  delete env.SOURCE_COVERAGE_DIR;
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, args, {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });
}
function prepare(dir, target) {
  const checked = execute(dir, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  if (checked.status !== 0) return checked;
  if (target.bundle)
    return execute(dir, [
      '-e',
      "require('esbuild').buildSync({entryPoints:['src/tables.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist/tables.cjs'})",
    ]);
  return checked;
}
function behavior(dir, target) {
  return execute(dir, ['--test', '--test-reporter=tap', '--test-name-pattern=^' + target.pattern + '$', target.test]);
}
function atomicWrite(file, content) {
  const staging = file + '.mutation-' + randomUUID();
  fs.writeFileSync(staging, content);
  try {
    fs.renameSync(staging, file);
  } finally {
    if (fs.existsSync(staging)) fs.unlinkSync(staging);
  }
}
function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rmp-mutations-'));
  const output = path.join(root, '.test-results', 'mutations', randomUUID());
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  try {
    for (const directory of ['src', 'tests', 'scripts'])
      fs.cpSync(path.join(root, directory), path.join(temporary, directory), { recursive: true });
    for (const file of ['package.json', 'tsconfig.json'])
      fs.copyFileSync(path.join(root, file), path.join(temporary, file));
    fs.symlinkSync(
      path.join(root, 'node_modules'),
      path.join(temporary, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    for (const target of targets) {
      const file = path.join(temporary, target.file),
        original = fs.readFileSync(file, 'utf8');
      if (original.split(target.before).length !== 2) throw Error('Mutation anchor changed: ' + target.id);
      const prepared = prepare(temporary, target);
      if (prepared.status !== 0) throw Error('Baseline compile/build failed: ' + target.id);
      const baseline = behavior(temporary, target);
      fs.writeFileSync(path.join(output, target.id + '-baseline.log'), baseline.stdout + '\n' + baseline.stderr);
      if (baseline.status !== 0 || !/# pass 1\b/.test(baseline.stdout))
        throw Error('Baseline targeted behavior did not pass: ' + target.id);
      try {
        atomicWrite(file, original.replace(target.before, target.after));
        const compiled = prepare(temporary, target);
        const result = compiled.status === 0 ? behavior(temporary, target) : compiled;
        const status = compiled.status === 0 ? classify(result) : 'invalid';
        results.push({ id: target.id, status, sourceHash: createHash('sha256').update(original).digest('hex') });
        fs.writeFileSync(path.join(output, target.id + '-mutant.log'), result.stdout + '\n' + result.stderr);
      } finally {
        atomicWrite(file, original);
        if (fs.readFileSync(file, 'utf8') !== original) throw Error('Mutation restoration failed: ' + target.id);
      }
    }
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'mutation-baseline.json'), 'utf8'));
    const failures = checkMutation(results, baseline);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
          results,
          failures,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log('Mutation evidence: ' + output);
    console.log(JSON.stringify(results));
    if (failures.length) throw Error(failures.join('\n'));
  } finally {
    // Cleanup is restricted to the exact mkdtemp directory; junction targets are never traversed.
    if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('rmp-mutations-'))
      throw Error('Unexpected temporary path');
    const modules = path.join(temporary, 'node_modules');
    if (fs.existsSync(modules)) fs.unlinkSync(modules);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) run();
module.exports = { targets };
