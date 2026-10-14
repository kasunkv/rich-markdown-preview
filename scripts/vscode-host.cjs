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
    else if (key === '--performance') { options.performance = true; options.privacy = true; }
    else if (key === '--privacy') options.privacy = true;
    else if (key === '--reload') { options.reload = true; options.privacy = true; }
    else if (key === '--providers') options.providers = true;
    else if (key === '--providers-only') { options.providers = true; options.providersOnly = true; }
    else if (['--version', '--mode', '--vsix', '--trust', '--executable'].includes(key) && args.length) options[key.slice(2)] = args.shift();
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  if (!['development', 'package'].includes(options.mode)) throw new Error('Mode must be development or package');
  if (!/^(stable|insiders|\d+\.\d+\.\d+)$/.test(options.version)) throw new Error('Version must be minimum/exact version, stable or insiders');
  if (options.trust && !['trusted','restricted','transition'].includes(options.trust)) throw new Error('Trust must be trusted, restricted or transition');
  if (options.performance && (options.mode !== 'development' || options.trust || options.providers || options.reload)) throw new Error('Performance proof requires an isolated normal development host');
  if (options.reload && (options.mode !== 'development' || options.trust || options.providers)) throw new Error('Reload proof requires a normal development host without trust/provider suite overrides');
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

/** Modal API prompts are refused in extension-test mode; use a normal isolated host. */
async function runPrivacyHost(options, {spawn = require('node:child_process').spawn, timeoutMs = options.extensionTestsEnv?.RICH_MARKDOWN_PREVIEW_PERFORMANCE_HOST === '1' ? 600000 : 180000} = {}) {
  const directory = path.dirname(options.extensionTestsEnv.RICH_MARKDOWN_PREVIEW_TEST_RESULT);
  if (!options.launchArgs.includes('--user-data-dir=' + path.join(directory,'user')) ||
      !options.launchArgs.includes('--extensions-dir=' + path.join(directory,'extensions')) ||
      !options.launchArgs.includes('--shared-data-dir=' + path.join(directory,'shared')) ||
      (!options.launchArgs.includes(path.join(directory,'workspace')) && !options.launchArgs.includes(path.join(directory,'providers.code-workspace'))))
    throw new Error('Privacy host requires its isolated profile, extensions and workspace');
  const development = options.privacyDevelopmentPaths.map(value => '--extensionDevelopmentPath=' + value);
  const args = [...options.launchArgs, ...development, '--new-window', '--no-sandbox', '--disable-gpu-sandbox', '--no-cached-data'];
  if (args.some(value => value.startsWith('--extensionTestsPath'))) throw new Error('Privacy host must use normal modal API behavior');
  return new Promise((resolve,reject) => {
    const child = spawn(options.vscodeExecutablePath,args,{env:{...process.env,...options.extensionTestsEnv},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',data => process.stdout.write(data));
    child.stderr?.on('data',data => process.stderr.write(data));
    let finished = false;
    const finish = (error) => {
      if (finished) return; finished = true; clearTimeout(timer);
      child.stdout?.destroy(); child.stderr?.destroy();
      if (error) reject(error); else resolve(0);
    };
    const timer = setTimeout(() => { finish(new Error('Privacy host timed out')); child.kill(); },timeoutMs);
    child.once('error',finish);
    child.once('exit',(code,signal) => finish(code === 0 ? undefined : new Error('Privacy host failed: ' + (code ?? signal))));
  });
}

// The test-electron launcher disables Workspace Trust; extension test mode also refuses modals.
// Trust proof uses the same isolated normal-host launcher as the privacy proof.
async function runTrustTests(options, spawn = require('node:child_process').spawn) {
  if(options.launchArgs.includes('--disable-workspace-trust')) throw new Error('Trust test must retain Workspace Trust');
  return runPrivacyHost(options,{spawn});
}

/** Reproduce a previously consented origin only inside a new test profile, never its trust state. */
async function seedTrustImageGrants(directory) {
  const resolved=path.resolve(directory), base=path.resolve(__dirname,'..','.test-results','host');
  const normal=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normal(path.dirname(resolved))!==normal(base)) throw new Error('Trust image seed requires an isolated host run');
  const storage=path.join(resolved,'user','User','globalStorage');
  await fs.mkdir(storage,{recursive:true});
  const {DatabaseSync}=require('node:sqlite');
  const database=new DatabaseSync(path.join(storage,'state.vscdb'));
  try {
    database.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    const origins=['https://trust-preview.invalid','https://saved-trust.invalid'];
    database.prepare('INSERT OR REPLACE INTO ItemTable (key,value) VALUES (?,?)').run((manifest.publisher+'.'+manifest.name).toLowerCase(),JSON.stringify({'richMarkdownPreview.externalImageOrigins.v1':origins}));
    return origins;
  } finally {database.close();}
}

async function run(options, electron = require('@vscode/test-electron')) {
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, '.test-results', 'host');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, `${options.version}-${options.mode}-`));
  const resultPath = path.join(directory, 'result.json');
  const report = { requestedVersion: options.version, mode: options.mode, trust: options.trust || 'disabled', os: os.platform(), arch: os.arch(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), startedAt: new Date().toISOString(), privacyHost: Boolean(options.privacy), providerHost: Boolean(options.providers), providerOnly: Boolean(options.providersOnly), passed: false };
  try {
    const workspace = path.join(directory, 'workspace');
    await fs.cp(path.join(root, 'tests', 'fixtures', 'workspace'), workspace, { recursive: true, filter: source => path.basename(source) !== '.vscode' });
    await fs.mkdir(path.join(workspace, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'node_modules', 'excluded.md'), '# Must not be indexed\n');
    await fs.mkdir(path.join(directory, 'user', 'User'), { recursive: true });
    await fs.writeFile(path.join(directory, 'user', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'workbench.enableExperiments': false, 'workbench.startupEditor': 'none', 'security.workspace.trust.startupPrompt':'never', ...((options.privacy || options.trust || options.providers) ? {'window.dialogStyle': 'custom'} : {}) }));
    if(options.trust && options.trust!=='trusted') report.seededImageOrigins=await seedTrustImageGrants(directory);
    const profiles = [`--user-data-dir=${path.join(directory, 'user')}`, `--extensions-dir=${path.join(directory, 'extensions')}`, `--shared-data-dir=${path.join(directory, 'shared')}`];
    report.storageRoots = {workspace,user:path.join(directory,'user'),extensions:path.join(directory,'extensions'),shared:path.join(directory,'shared')};
    const executable = options.executable ? path.resolve(options.executable) : await electron.downloadAndUnzipVSCode({ version: options.version, cachePath: path.join(root, '.test-results', 'host-downloads') });
    if(options.executable && !(await fs.stat(executable)).isFile()) throw new Error('Existing host executable must be a file');
    report.executable=executable;
    if (options.mode === 'development') report.runtimeHashes=Object.fromEntries(await Promise.all(['extension.js','preview.js','preview.css'].map(async name=>[name,require('node:crypto').createHash('sha256').update(await fs.readFile(path.join(root,'dist',name))).digest('hex')])));
    report.reloadHost=Boolean(options.reload);
    report.performanceHost=Boolean(options.performance);
    let developmentPath = root;
    if (options.mode === 'package') {
      const vsix = path.resolve(options.vsix || path.join(root, `${manifest.name}-${manifest.version}.vsix`));
      const verified = await require('./verify-release.cjs').verifyRelease({ filename: vsix });
      report.runtimeHashes = verified.vsix.runtimeHashes;
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
    let privacyDevelopmentPaths;
    if (options.privacy || options.trust || options.providers) {
      const harness = path.join(directory,'privacy-harness');
      await fs.mkdir(harness);
      await fs.writeFile(path.join(harness,'package.json'),JSON.stringify({name:'privacy-host-harness',publisher:'test',version:'0.0.1',engines:{vscode:'^1.95.0'},activationEvents:['onStartupFinished'],main:'./extension.cjs',capabilities:{untrustedWorkspaces:{supported:true}}}));
      const suite = path.join(root,'tests',options.performance ? 'vscode-performance.cjs' : options.reload ? 'vscode-reload.cjs' : options.providers ? 'vscode-providers.cjs' : options.trust ? 'vscode-trust.cjs' : 'vscode-settings.cjs');
      await fs.writeFile(path.join(harness,'extension.cjs'),
        'const vscode=require("vscode");exports.activate=()=>{' + (options.providers ? 'require(' + JSON.stringify(path.join(root,'tests','provider-host.cjs')) + ').registerProviderFixture(vscode);' : '') + 'setTimeout(async()=>{let result;try{result=await require(' + JSON.stringify(suite) + ').run();}catch{console.error("Isolated host privacy suite failed; see suite.json");}finally{if(!result?.reloading)await vscode.commands.executeCommand("workbench.action.quit");}},500);};');
      privacyDevelopmentPaths = [...(options.mode === 'development' ? [root] : []),harness];
      report.dialogFixture = 'normal host with window.dialogStyle=custom';
      report.storageRoots = {workspace,user:path.join(directory,'user'),extensions:path.join(directory,'extensions'),shared:path.join(directory,'shared')};
    }
    let launchWorkspace=workspace;
    if(options.providers){launchWorkspace=path.join(directory,'providers.code-workspace');await fs.writeFile(launchWorkspace,JSON.stringify({folders:[...(options.providersOnly ? [] : [{path:workspace}]),{uri:'rmp-readonly://fixture/one',name:'Provider One'},{uri:'rmp-readonly://fixture/two',name:'Provider Two'}]}));}
    const debugServer = require('node:net').createServer();
    await new Promise(resolve => debugServer.listen(0, '127.0.0.1', resolve));
    const debugPort = debugServer.address().port;
    await new Promise(resolve => debugServer.close(resolve));
    const launch = options.trust ? (electron.runTrustTests || runTrustTests) : (options.privacy || options.providers) ? (electron.runPrivacyHost || runPrivacyHost) : electron.runTests;
    const exitCode = await launch({ privacyDevelopmentPaths, vscodeExecutablePath: executable, extensionDevelopmentPath: developmentPath, extensionTestsPath: path.join(root, 'tests', options.providers ? 'vscode-providers.cjs' : options.trust ? 'vscode-trust.cjs' : 'vscode-settings.cjs'), launchArgs: [launchWorkspace, ...profiles, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--skip-welcome', '--skip-release-notes', ...(options.trust ? [] : ['--disable-workspace-trust']), '--disable-updates', '--disable-telemetry'], extensionTestsEnv: { NODE_DISABLE_COMPILE_CACHE: '1', RICH_MARKDOWN_PREVIEW_TEST_TRUST: options.trust || 'disabled', RICH_MARKDOWN_PREVIEW_PRIVACY_HOST: options.privacy ? '1' : '0', RICH_MARKDOWN_PREVIEW_PERFORMANCE_HOST: options.performance ? '1' : '0', RICH_MARKDOWN_PREVIEW_DEBUG_PORT: String(debugPort), RICH_MARKDOWN_PREVIEW_TEST_RESULT: path.join(directory, 'suite.json'), RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE: workspace, RICH_MARKDOWN_PREVIEW_TEST_MODE: options.mode, RICH_MARKDOWN_PREVIEW_TEST_EXTENSIONS: path.join(directory, 'extensions'), RICH_MARKDOWN_PREVIEW_FORCE_FAILURE: options.forceFailure ? '1' : '0' } });
    report.suite = JSON.parse(await fs.readFile(path.join(directory, 'suite.json'), 'utf8'));
    report.hostVersion = report.suite.hostVersion;
    if (exitCode !== 0 || !report.suite.passed) throw new Error(`Host smoke failed (exit ${exitCode})`);
    if (/^\d/.test(options.version) && report.hostVersion !== options.version) throw new Error(`Expected host ${options.version}, got ${report.hostVersion}`);
    if(options.trust==='transition') {
      const {DatabaseSync}=require('node:sqlite');
      const database=new DatabaseSync(path.join(directory,'user','User','globalStorage','state.vscdb'),{readOnly:true});
      try {
        const row=database.prepare('SELECT value FROM ItemTable WHERE key=?').get((manifest.publisher+'.'+manifest.name).toLowerCase());
        report.persistedImageOrigins=JSON.parse(typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString())['richMarkdownPreview.externalImageOrigins.v1'];
        if(!report.seededImageOrigins.every(origin=>report.persistedImageOrigins.includes(origin))) throw new Error('Native reallow must preserve prior production permissions');
      } finally {database.close();}
    }
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

module.exports = { parseArgs, run, windowsCliScript, runPrivacyHost, runTrustTests, seedTrustImageGrants };
if (require.main === module) Promise.resolve().then(() => run(parseArgs(process.argv.slice(2)))).catch(error => { console.error(error); process.exitCode = 1; });
