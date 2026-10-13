const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { finalCheck } = require('./final-coverage-policy.cjs');
const { sources, instrument } = require('./coverage-instrument.cjs');
const root = path.resolve(__dirname, '..');
const [report, safetyPath, exceptionsPath, base] = process.argv.slice(2);
if (!report || !safetyPath || !exceptionsPath || !base)
  throw Error('Usage: node scripts/final-coverage-check.cjs coverage-final.json safety.json exceptions.json base-ref');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const coverage = read(report),
  safety = read(safetyPath);
if (!Array.isArray(safety) || !safety.length) throw Error('Reviewed safety branch inventory is required');
const git = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error('Cannot establish changed-code diff: ' + result.stderr);
  return result.stdout;
};
git(['rev-parse', '--verify', base + '^{commit}']);
const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', base, '--', 'src']);
const inventory = sources(path.join(root, 'src'));
for (const file of inventory) {
  if (!coverage[file]) continue; // finalCheck reports the missing inventory entry.
  const original = instrument(file).coverage;
  for (const key of ['statementMap', 'fnMap', 'branchMap'])
    if (JSON.stringify(original[key]) !== JSON.stringify(coverage[file][key]))
      throw Error('Stale original TypeScript locations: ' + file + ' ' + key);
}
const failures = finalCheck({ coverage, inventory, diff, safety, exceptions: read(exceptionsPath) });
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
