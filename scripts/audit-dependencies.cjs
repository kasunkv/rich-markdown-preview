const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { reviewException } = require('./dependency-policy.cjs');
function evaluateAudit(report, policy, now = new Date()) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities)
    throw new Error('Invalid or unavailable npm audit response');
  for (const item of policy.exceptions) reviewException(item, now);
  const containsHighSource = (name, visited = new Set()) => {
    if (visited.has(name)) return false;
    visited.add(name);
    return report.vulnerabilities[name]?.via?.some((item) =>
      typeof item === 'object'
        ? ['high', 'critical'].includes(item?.severity)
        : containsHighSource(item, new Set(visited)),
    );
  };
  const failures = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !['info', 'low', 'moderate', 'high', 'critical'].includes(vulnerability.severity) ||
      !Array.isArray(vulnerability.via)
    )
      throw new Error(`Invalid advisory record: ${name}`);
    // String entries propagate a dependency advisory: its source object is checked separately.
    for (const advisory of vulnerability.via.filter((item) => typeof item === 'object')) {
      if (
        !['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity) ||
        !Number.isInteger(advisory.source) ||
        !advisory.url?.startsWith('https://') ||
        typeof advisory.range !== 'string'
      )
        throw new Error('Invalid source advisory');
      if (!['high', 'critical'].includes(advisory.severity)) continue;
      const exception = policy.exceptions.find(
        (item) => item.package === name && item.advisory === advisory.url && item.range === advisory.range,
      );
      if (!exception) failures.push(`${name}: ${advisory.severity} ${advisory.url} (${advisory.range})`);
    }
    for (const via of vulnerability.via.filter((item) => typeof item === 'string'))
      if (!report.vulnerabilities[via]) throw new Error('Missing propagated advisory: ' + via);
    if (['high', 'critical'].includes(vulnerability.severity) && !containsHighSource(name))
      failures.push(`${name}: unrecognized high/critical advisory`);
  }
  if (failures.length) throw new Error(`Dependency advisory gate failed:\n${failures.join('\n')}`);
  return report.metadata.vulnerabilities;
}
async function audit(root = process.cwd(), { run = spawnSync } = {}) {
  const policy = JSON.parse(await fs.readFile(path.join(root, 'scripts/advisory-exceptions.json'), 'utf8'));
  const output = path.join(root, '.test-results/dependencies');
  await fs.mkdir(output, { recursive: true });
  const failures = [];
  const status = { checkedAt: new Date().toISOString(), scopes: {} };
  for (const scope of ['full', 'runtime']) {
    // Use npm's JS entrypoint on Windows rather than executing an interpolated shell command.
    const args = ['audit', '--json', ...(scope === 'runtime' ? ['--omit=dev'] : [])];
    await fs.rm(path.join(output, `${scope}-audit.json`), { force: true });
    const result = process.env.npm_execpath
      ? run(process.execPath, [process.env.npm_execpath, ...args], { cwd: root, encoding: 'utf8' })
      : run('npm', args, { cwd: root, encoding: 'utf8' });
    try {
      if (result.error || ![0, 1].includes(result.status))
        throw new Error(result.error?.message || result.stderr || `npm exited ${result.status}`);
      const report = JSON.parse(result.stdout);
      await fs.writeFile(path.join(output, `${scope}-audit.json`), JSON.stringify(report, null, 2) + '\n');
      const summary = evaluateAudit(report, policy);
      status.scopes[scope] = { passed: true, summary };
      console.log(`${scope} advisories:`, summary);
    } catch (error) {
      status.scopes[scope] = { passed: false, error: error.message };
      failures.push(`${scope}: ${error.message}`);
    }
  }
  await fs.writeFile(path.join(output, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  if (failures.length) throw new Error(failures.join('\n'));
}
if (require.main === module)
  audit().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { evaluateAudit, audit };
