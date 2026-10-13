const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function verify(directory = path.resolve(__dirname, '../.test-results/host')) {
  const results = fs.readdirSync(directory).map(name => path.join(directory, name, 'result.json')).filter(file => fs.existsSync(file)).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latest = results.at(-1);
  assert.ok(latest && !latest.passed && latest.suite?.error?.includes('Forced host failure fixture'), 'Latest run must reach the deliberately failing host assertion');
  return latest;
}
module.exports = { verify };
if (require.main === module) verify();
