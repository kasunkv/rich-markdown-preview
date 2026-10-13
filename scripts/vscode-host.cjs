const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const manifest = require('../package.json');

function parseArgs(args) {
  const options = { version: '1.95.0', mode: 'development', forceFailure: false };
  while (args.length) {
    const key = args.shift();
    if (key === '--force-failure') options.forceFailure = true;
    else if (['--version', '--mode', '--vsix', '--trust'].includes(key) && args.length) options[key.slice(2)] = args.shift();
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  if (!['development', 'package'].includes(options.mode)) throw new Error('Mode must be development or package');
  if (!/^(stable|insiders|\d+\.\d+\.\d+)$/.test(options.version)) throw new Error('Version must be minimum/exact version, stable or insiders');
  if (options.trust && !['trusted', 'restricted', 'transition'].includes(options.trust)) throw new Error('Trust must be trusted, restricted or transition');
  return options;
}

async function windowsCliScript(executable) {
  const directory = path.dirname(executable);
  const candidates = [directory, ...(await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name))];
  for (const candidate of candidates) {
    const script = path.join(candidate, 'resources', 'app', 'out', 'cli.js');
    try { await fs.access(script); return script; } catch { /* Older archives use resources directly; newer ones use a version directory. */ }
  }
  throw new Error('Downloaded Windows host has no CLI script');
}

async function run(options, electron = require('@vscode/test-electron')) {
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, '.test-results', 'host');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, `${options.version}-${options.mode}-`));
  const resultPath = path.join(directory, 'result.json');
  const report = { requestedVersion: options.version, mode: options.mode, trust: options.trust || 'disabled', os: os.platform(), arch: os.arch(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), startedAt: new Date().toISOString(), passed: false };
  try {
    const workspace = path.join(directory, 'workspace');
    await fs.cp(path.join(root, 'tests', 'fixtures', 'workspace'), workspace, { recursive: true, filter: source => path.basename(source) !== '.vscode' });
    await fs.mkdir(path.join(workspace, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'node_modules', 'excluded.md'), '# Must not be indexed\n');
    await fs.mkdir(path.join(directory, 'user', 'User'), { recursive: true });
    await fs.writeFile(path.join(directory, 'user', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'workbench.enableExperiments': false, 'workbench.startupEditor': 'none', 'security.workspace.trust.startupPrompt': 'never' }));
    const profiles = [`--user-data-dir=${path.join(directory, 'user')}`, `--extensions-dir=${path.join(directory, 'extensions')}`];
    const executable = await electron.downloadAndUnzipVSCode({ version: options.version, cachePath: path.join(root, '.test-results', 'host-downloads') });
    let developmentPath = root;
    if (options.mode === 'package') {
      const vsix = path.resolve(options.vsix || path.join(root, `${manifest.name}-${manifest.version}.vsix`));
      await require('./verify-release.cjs').verifyRelease({ filename: vsix });
      const [cli] = electron.resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
      // Launch Windows' CLI JS directly: .cmd + shell corrupts space/% paths.
      const cliArgs = [...profiles, '--install-extension', vsix, '--force'];
      if (process.platform === 'win32') {
        execFileSync(executable, [await windowsCliScript(executable), ...cliArgs], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true, timeout: 120000 });
      } else execFileSync(cli, cliArgs, { stdio: 'inherit', timeout: 120000 });
      developmentPath = path.join(directory, 'harness');
      await fs.mkdir(developmentPath);
      await fs.writeFile(path.join(developmentPath, 'package.json'), JSON.stringify({ name: 'host-smoke-harness', publisher: 'test', version: '0.0.1', engines: { vscode: '^1.95.0' }, main: './extension.cjs' }));
      await fs.writeFile(path.join(developmentPath, 'extension.cjs'), 'exports.activate = () => {};');
      report.vsix = vsix;
      report.vsixSha256 = require('node:crypto').createHash('sha256').update(await fs.readFile(vsix)).digest('hex');
    }
    const debugServer = require('node:net').createServer();
    await new Promise(resolve => debugServer.listen(0, '127.0.0.1', resolve));
    const debugPort = debugServer.address().port;
    await new Promise(resolve => debugServer.close(resolve));
    const exitCode = await electron.runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: developmentPath, extensionTestsPath: path.join(root, 'tests', options.trust ? 'vscode-trust.cjs' : 'vscode-settings.cjs'), launchArgs: [workspace, ...profiles, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--skip-welcome', '--skip-release-notes', ...(options.trust ? [] : ['--disable-workspace-trust']), '--disable-updates', '--disable-telemetry'], extensionTestsEnv: { RICH_MARKDOWN_PREVIEW_DEBUG_PORT: String(debugPort), RICH_MARKDOWN_PREVIEW_TEST_TRUST: options.trust || 'disabled', RICH_MARKDOWN_PREVIEW_TEST_RESULT: path.join(directory, 'suite.json'), RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE: workspace, RICH_MARKDOWN_PREVIEW_TEST_MODE: options.mode, RICH_MARKDOWN_PREVIEW_TEST_EXTENSIONS: path.join(directory, 'extensions'), RICH_MARKDOWN_PREVIEW_FORCE_FAILURE: options.forceFailure ? '1' : '0' } });
    report.suite = JSON.parse(await fs.readFile(path.join(directory, 'suite.json'), 'utf8'));
    report.hostVersion = report.suite.hostVersion;
    if (exitCode !== 0 || !report.suite.passed) throw new Error(`Host smoke failed (exit ${exitCode})`);
    if (/^\d/.test(options.version) && report.hostVersion !== options.version) throw new Error(`Expected host ${options.version}, got ${report.hostVersion}`);
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    try { report.suite = JSON.parse(await fs.readFile(path.join(directory, 'suite.json'), 'utf8')); report.hostVersion = report.suite.hostVersion; } catch { /* Host may have failed before loading the suite. */ }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(resultPath, JSON.stringify(report, null, 2));
    console.log(`Host evidence: ${resultPath}`);
  }
  return report;
}

module.exports = { parseArgs, run, windowsCliScript };
if (require.main === module) Promise.resolve().then(() => run(parseArgs(process.argv.slice(2)))).catch(error => { console.error(error); process.exitCode = 1; });
