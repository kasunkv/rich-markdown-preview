const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startPreviewServer } = require('../preview-server.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test('concurrent allocated servers are independent and cleanup closes both ports', async () => {
  const servers = await Promise.all([startPreviewServer(), startPreviewServer()]);
  try {
    assert.notEqual(servers[0].url, servers[1].url);
    for (const server of servers) assert.equal((await fetch(server.url + '/document')).status, 200);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
  for (const server of servers) await assert.rejects(fetch(server.url));
});

test('fixture and bind startup failures reject promptly without leaking a server', { timeout: 5000 }, async () => {
  await assert.rejects(startPreviewServer({ fixture: 'missing-fixture.md' }), /ENOENT/);
  const server = await startPreviewServer();
  try {
    await assert.rejects(startPreviewServer({ port: Number(new URL(server.url).port) }), /EADDRINUSE/);
    assert.equal((await fetch(server.url)).status, 200);
  } finally {
    await server.close();
  }
});

test(
  'assertion failure leaves tagged failure metadata, trace, screenshot and console evidence',
  { timeout: 60000 },
  async () => {
    const child = spawn(process.execPath, ['scripts/browser-runner.cjs', '--probe'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.notEqual(code, 0, output);
    const runDir = output.match(/Browser evidence: (.+)/)?.[1].trim();
    assert.ok(runDir, output);
    const metadata = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json')));
    assert.equal(metadata.status, 'failed');
    assert.match(metadata.commit, /^[a-f0-9]{40}$/);
    assert.ok(metadata.finishedAt);
    assert.ok(metadata.runId);
    const artifacts = fs.readdirSync(path.join(runDir, 'artifacts'), { recursive: true });
    assert.ok(
      artifacts.some((file) => file.endsWith('trace.zip')),
      artifacts.join(','),
    );
    assert.ok(artifacts.some((file) => file.endsWith('.png')));
    const consolePath = artifacts.find((file) => file.endsWith('console.log'));
    assert.match(fs.readFileSync(path.join(runDir, 'artifacts', consolePath), 'utf8'), /Current-run evidence probe/);
    const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json')));
    assert.equal(report.stats.unexpected, 1);
  },
);
