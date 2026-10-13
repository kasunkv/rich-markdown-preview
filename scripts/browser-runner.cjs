const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const runId = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
const runDir = path.join(root, '.test-results', 'browser', runId);
fs.mkdirSync(runDir, { recursive: true });
const metadata = {
  runId,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  lockSha256: createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'package-lock.json')))
    .digest('hex'),
  startedAt: new Date().toISOString(),
  status: 'running',
  marketing: process.argv.includes('--marketing'),
  playwright: require('@playwright/test/package.json').version,
};
const save = () => fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(metadata, null, 2));
save();
console.log('Browser evidence: ' + runDir);
const child = spawn(
  process.execPath,
  [
    require.resolve('@playwright/test/cli'),
    'test',
    '--config=playwright.config.cjs',
    ...process.argv.slice(2).filter((arg) => arg !== '--marketing' && arg !== '--probe'),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      BROWSER_RUN_DIR: runDir,
      BROWSER_MARKETING: metadata.marketing ? '1' : '0',
      BROWSER_PROBE: process.argv.includes('--probe') ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const log = fs.createWriteStream(path.join(runDir, 'runner.log'));
child.stdout.on('data', (data) => {
  process.stdout.write(data);
  log.write(data);
});
child.stderr.on('data', (data) => {
  process.stderr.write(data);
  log.write(data);
});
let startupError;
child.once('error', (error) => {
  startupError = error;
});
child.once('close', (code, signal) => {
  metadata.status =
    metadata.status === 'interrupted' ? 'interrupted' : code === 0 && !startupError ? 'passed' : 'failed';
  metadata.finishedAt = new Date().toISOString();
  metadata.exitCode = code;
  metadata.signal = signal;
  if (startupError) metadata.error = startupError.stack;
  save();
  log.end();
  process.exitCode = metadata.status === 'passed' ? 0 : 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    metadata.status = 'interrupted';
    metadata.finishedAt = new Date().toISOString();
    save();
    child.kill(signal);
  });
