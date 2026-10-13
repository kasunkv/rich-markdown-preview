const fs = require('node:fs');
const { check } = require('./coverage-policy.cjs');
const [summary, baseline, exceptions] = process.argv.slice(2);
if (!summary || !baseline)
  throw new Error('Usage: node scripts/coverage-check.cjs summary.json baseline.json [exceptions.json]');
const failures = check(
  JSON.parse(fs.readFileSync(summary, 'utf8')),
  JSON.parse(fs.readFileSync(baseline, 'utf8')),
  exceptions ? JSON.parse(fs.readFileSync(exceptions, 'utf8')) : [],
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
