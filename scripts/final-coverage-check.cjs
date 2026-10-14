const fs = require('node:fs');
const path = require('node:path');
const { enforce } = require('./final-coverage-enforcement.cjs');
const [report, base] = process.argv.slice(2);
if (!report || !base) throw Error('Usage: node scripts/final-coverage-check.cjs coverage-final.json base-ref');
const result = enforce(JSON.parse(fs.readFileSync(report, 'utf8')), path.resolve(__dirname, '..'), base);
if (result.failures.length) {
  console.error(result.failures.join('\n'));
  process.exitCode = 1;
} else console.log('Final coverage, safety and changed-code gate passed against ' + result.base);
