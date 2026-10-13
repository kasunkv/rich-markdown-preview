const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs, run } = require('../scripts/vscode-host.cjs');

test('API floor is pinned in manifest and lockfile', () => {
  assert.equal(require('../package.json').engines.vscode, '^1.95.0');
  assert.equal(require('../package.json').devDependencies['@types/vscode'], '1.95.0');
  assert.equal(require('../package-lock.json').packages['node_modules/@types/vscode'].version, '1.95.0');
});

test('host runner rejects ambiguous options', () => {
  assert.deepEqual(parseArgs([]), { version: '1.95.0', mode: 'development', forceFailure: false });
  for (const args of [['--mode', 'typo'], ['--version'], ['--version', '../host'], ['--unknown']]) assert.throws(() => parseArgs(args));
});

test('host runner isolates each run and propagates host failures with current evidence', async () => {
  const directories = [];
  const electron = {
    downloadAndUnzipVSCode: async options => { assert.equal(options.version, '1.95.0'); return '/downloaded/host'; },
    runTests: async options => {
      const env = options.extensionTestsEnv;
      const directory = path.dirname(env.RICH_MARKDOWN_PREVIEW_TEST_RESULT);
      directories.push(directory);
      assert.ok(options.launchArgs.includes(`--user-data-dir=${path.join(directory, 'user')}`));
      assert.ok(options.launchArgs.includes(`--extensions-dir=${path.join(directory, 'extensions')}`));
      assert.ok((await fs.readFile(path.join(env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE, 'URI space # percent % café.md'), 'utf8')).includes('Local image'));
      await fs.writeFile(env.RICH_MARKDOWN_PREVIEW_TEST_RESULT, JSON.stringify({ hostVersion: '1.95.0', passed: env.RICH_MARKDOWN_PREVIEW_FORCE_FAILURE !== '1' }));
      if (env.RICH_MARKDOWN_PREVIEW_FORCE_FAILURE === '1') throw new Error('Host exited 1');
      return 0;
    }
  };
  try {
    assert.equal((await run(parseArgs([]), electron)).passed, true);
    await assert.rejects(run(parseArgs(['--force-failure']), electron), /Host exited 1/);
    assert.notEqual(directories[0], directories[1]);
    const report = JSON.parse(await fs.readFile(path.join(directories[1], 'result.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.hostVersion, '1.95.0');
    assert.equal(report.os, process.platform);
    assert.match(report.commit, /^[a-f0-9]{40}$/);
  } finally {
    for (const directory of directories) await fs.rm(directory, { recursive: true, force: true });
  }
});

test('negative control rejects infrastructure failures masquerading as forced failures', async () => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'host-negative-'));
  try {
    await fs.mkdir(path.join(directory, 'run'));
    const result = path.join(directory, 'run', 'result.json');
    await fs.writeFile(result, JSON.stringify({ startedAt: '2026-10-12', passed: false, error: 'Download failed' }));
    assert.throws(() => require('../scripts/verify-host-failure.cjs').verify(directory), /deliberately failing/);
    await fs.writeFile(result, JSON.stringify({ startedAt: '2026-10-12', passed: false, suite: { error: 'Error: Forced host failure fixture' } }));
    assert.equal(require('../scripts/verify-host-failure.cjs').verify(directory).passed, false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('Windows CLI discovery supports old and version-directory archive layouts', async () => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'host-layout-'));
  const { windowsCliScript } = require('../scripts/vscode-host.cjs');
  try {
    await assert.rejects(windowsCliScript(path.join(directory, 'Code.exe')), /no CLI script/);
    for (const prefix of ['', 'version-hash']) {
      const script = path.join(directory, prefix, 'resources/app/out/cli.js');
      await fs.mkdir(path.dirname(script), { recursive: true });
      await fs.writeFile(script, 'fixture');
      assert.equal(await windowsCliScript(path.join(directory, 'Code.exe')), script);
      await fs.rm(path.join(directory, prefix || 'resources'), { recursive: true, force: true });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
