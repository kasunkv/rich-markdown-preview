const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { sources, instrument } = require('./coverage-instrument.cjs');
const { finalCheck } = require('./final-coverage-policy.cjs');
const sourceDigest = (text) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
function enforce(coverage, root, base) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw Error('Cannot establish changed-code diff: ' + r.stderr);
    return r.stdout.trim();
  };
  const resolved = git(['rev-parse', '--verify', '--end-of-options', (base || 'HEAD^') + '^{commit}']);
  const diff = git([
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--unified=0',
    resolved,
    '--',
    'src',
  ]);
  const inventory = sources(path.join(root, 'src'));
  const review = JSON.parse(fs.readFileSync(path.join(root, 'safety-policy.json'), 'utf8'));
  const safety = JSON.parse(fs.readFileSync(path.join(root, 'safety-branches.json'), 'utf8'));
  const names = inventory.map((file) => path.relative(path.join(root, 'src'), file).replaceAll('\\', '/')).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(review.sourceHashes).sort()))
    throw Error('Executable inventory changed; review safety classifications for every application module');

  if (!safety.length) throw Error('Reviewed safety branch inventory is required');
  for (const [file, expected] of Object.entries(review.sourceHashes)) {
    if (sourceDigest(fs.readFileSync(path.join(root, 'src', file), 'utf8')) !== expected)
      throw Error('Safety source changed; review branch inventory and proofs: ' + file);
  }
  for (const file of inventory) {
    if (!coverage[file]) continue;
    const original = instrument(file).coverage;
    for (const key of ['statementMap', 'fnMap', 'branchMap'])
      if (JSON.stringify(original[key]) !== JSON.stringify(coverage[file][key]))
        throw Error('Stale original TypeScript locations: ' + file + ' ' + key);
  }
  // Complete-module policies cannot lose branches from the reviewed safety inventory.
  for (const module of review.completeModules) {
    const file = inventory.find((file) => path.relative(path.join(root, 'src'), file).replaceAll('\\', '/') === module);
    if (!file) throw Error('Missing complete safety module: ' + module);
    for (const id of Object.keys(instrument(file).coverage.branchMap))
      if (!safety.some((item) => item.module === module && item.branch === id))
        throw Error('Missing reviewed safety branch: ' + module + ':' + id);
  }
  const exceptions = JSON.parse(fs.readFileSync(path.join(root, 'safety-exceptions.json'), 'utf8'));
  return {
    base: resolved,
    failures: finalCheck({ coverage, inventory, diff, safety, exceptions }),
    safetyArms: safety.reduce((n, b) => n + b.location.locations.length, 0),
  };
}
module.exports = { enforce, sourceDigest };
