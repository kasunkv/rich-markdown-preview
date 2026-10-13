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

test('explicit trust modes retain Workspace Trust in isolated profiles', async () => {
  for (const trust of ['restricted', 'trusted', 'transition']) {
    assert.equal(parseArgs(['--trust', trust]).trust, trust);
    let directory;
    try {
      await run(parseArgs(['--trust', trust]), {
        downloadAndUnzipVSCode: async () => '/downloaded/host',
        runTrustTests: async options => {
          const env = options.extensionTestsEnv;
          directory = path.dirname(env.RICH_MARKDOWN_PREVIEW_TEST_RESULT);
          assert.equal(env.RICH_MARKDOWN_PREVIEW_TEST_TRUST, trust);
          assert.ok(!options.launchArgs.includes('--disable-workspace-trust'));
          assert.equal(path.basename(options.extensionTestsPath), 'vscode-trust.cjs');
          const settings = JSON.parse(await fs.readFile(path.join(directory, 'user', 'User', 'settings.json')));
          assert.equal(settings['security.workspace.trust.startupPrompt'], 'never');
          await fs.writeFile(env.RICH_MARKDOWN_PREVIEW_TEST_RESULT, JSON.stringify({hostVersion: '1.95.0', passed: true}));
          return 0;
        }
      });
    } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
  }
  assert.throws(() => parseArgs(['--trust', 'unknown']), /Trust must/);
});

test('direct trust launcher keeps real trust, normal modals and all storage isolated', async () => {
  const {EventEmitter}=require('node:events');
  const {runTrustTests}=require('../scripts/vscode-host.cjs');
  const directory=path.resolve('.test-results','host','fixture-trust-unit');
  const options={vscodeExecutablePath:'/immutable/Code.exe',launchArgs:[path.join(directory,'workspace'),'--user-data-dir='+path.join(directory,'user'),'--extensions-dir='+path.join(directory,'extensions')],privacyDevelopmentPaths:['/source','/fixture/harness'],extensionTestsEnv:{RICH_MARKDOWN_PREVIEW_TEST_RESULT:path.join(directory,'suite.json'),TRUST_FIXTURE:'1'}};
  let calls=0;
  const spawn=(executable,args,config)=>{
    calls++;
    assert.equal(executable,options.vscodeExecutablePath);
    assert.ok(!args.includes('--disable-workspace-trust'));
    assert.ok(!args.some(value=>value.startsWith('--extensionTestsPath')));
    assert.ok(args.includes('--shared-data-dir='+path.join(directory,'shared')));
    assert.ok(args.includes('--extensionDevelopmentPath=/fixture/harness'));
    assert.equal(config.env.TRUST_FIXTURE,'1');assert.equal(config.windowsHide,true);
    const child=new EventEmitter();child.kill=()=>{};setImmediate(()=>child.emit('exit',calls===1?0:1));return child;
  };
  assert.equal(await runTrustTests(options,spawn),0);
  await assert.rejects(runTrustTests(options,spawn),/host failed: 1/);
  await assert.rejects(runTrustTests({...options,launchArgs:['--disable-workspace-trust']},spawn),/retain Workspace Trust/);
  await assert.rejects(runTrustTests(options,()=>{const child=new EventEmitter();child.kill=()=>{};setImmediate(()=>child.emit('error',Error('Failed to launch')));return child;}),/Failed to launch/);
});

test('normal privacy host fixture keeps dialogs and all storage roots in isolated runs', async () => {
  const directories = [];
  const electron = {
    downloadAndUnzipVSCode: async () => '/immutable/cache/Code.exe',
    runPrivacyHost: async options => {
      const directory = path.dirname(options.extensionTestsEnv.RICH_MARKDOWN_PREVIEW_TEST_RESULT); directories.push(directory);
      assert.equal(options.extensionTestsEnv.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST,'1');
      const harness = options.privacyDevelopmentPaths.at(-1);
      const manifest = JSON.parse(await fs.readFile(path.join(harness,'package.json'),'utf8'));
      assert.deepEqual(manifest.activationEvents,['onStartupFinished']);
      const source = await fs.readFile(path.join(harness,'extension.cjs'),'utf8');
      assert.match(source,/workbench.action.quit/); assert.doesNotMatch(source,/extensionTestsPath/);
      const settings = JSON.parse(await fs.readFile(path.join(directory,'user','User','settings.json'),'utf8'));
      assert.equal(settings['window.dialogStyle'],'custom');
      await fs.writeFile(options.extensionTestsEnv.RICH_MARKDOWN_PREVIEW_TEST_RESULT,JSON.stringify({passed:true,hostVersion:'1.95.0'}));
      return 0;
    },
  };
  try {
    const result = await run(parseArgs(['--privacy']),electron);
    assert.equal(result.privacyHost,true); assert.match(result.dialogFixture,/normal host/);
    for(const root of Object.values(result.storageRoots)) assert.equal(path.dirname(root),directories[0]);
  } finally {
    for(const directory of directories) {
      assert.equal(path.dirname(directory),path.resolve('.test-results','host'));
      await fs.rm(directory,{recursive:true,force:true});
    }
  }
});

test('normal privacy launcher omits test mode and bounds cleanup to its spawned process', async () => {
  const {EventEmitter} = require('node:events');
  const {PassThrough} = require('node:stream');
  const {runPrivacyHost} = require('../scripts/vscode-host.cjs');
  const directory = path.resolve('.test-results','host','fixture-only');
  const options = {vscodeExecutablePath:'/immutable/Code.exe',privacyDevelopmentPaths:['/extension','/fixture/harness'],launchArgs:[path.join(directory,'workspace'),'--user-data-dir='+path.join(directory,'user'),'--extensions-dir='+path.join(directory,'extensions')],extensionTestsEnv:{RICH_MARKDOWN_PREVIEW_TEST_RESULT:path.join(directory,'suite.json')}};
  let kills=0;
  const child = () => {const result=new EventEmitter();result.stdout=new PassThrough();result.stderr=new PassThrough();result.kill=()=>{kills++;result.emit('exit',0);};return result;};
  await assert.rejects(runPrivacyHost({...options,launchArgs:[]}),/isolated/);
  await assert.rejects(runPrivacyHost({...options,launchArgs:[...options.launchArgs,'--extensionTestsPath=/bad']}),/normal modal/);
  const launch = runPrivacyHost(options,{spawn:(executable,args,config)=>{
    assert.equal(executable,options.vscodeExecutablePath);assert.equal(config.windowsHide,true);
    assert.ok(args.includes('--shared-data-dir='+path.join(directory,'shared')));
    assert.ok(args.includes('--extensionDevelopmentPath=/fixture/harness'));
    assert.equal(args.some(arg=>arg.startsWith('--extensionTestsPath')),false);
    const result=child();setImmediate(()=>result.emit('exit',0));return result;
  }});
  assert.equal(await launch,0);assert.equal(kills,0);
  await assert.rejects(runPrivacyHost(options,{timeoutMs:5,spawn:()=>child()}),/timed out/);
  assert.equal(kills,1);
  await assert.rejects(runPrivacyHost(options,{spawn:()=>{const result=child();setImmediate(()=>result.emit('error',Error('spawn failed')));return result;}}),/spawn failed/);
});

test('saved-origin trust fixture seeds only its own production user-store row, never trust flags',async()=>{
  const {seedTrustImageGrants}=require('../scripts/vscode-host.cjs');
  await assert.rejects(seedTrustImageGrants(require('node:os').tmpdir()),/isolated host run/);
  const directory=await fs.mkdtemp(path.resolve('.test-results','host','seed-trust-'));
  try{
    assert.deepEqual(await seedTrustImageGrants(directory),['https://trust-preview.invalid','https://saved-trust.invalid']);
    const {DatabaseSync}=require('node:sqlite');
    const database=new DatabaseSync(path.join(directory,'user','User','globalStorage','state.vscdb'),{readOnly:true});
    try{
      const rows=database.prepare('SELECT key,CAST(value AS TEXT) AS value FROM ItemTable').all();
      assert.equal(rows.length,1);assert.equal(rows[0].key,'kasunkodagoda.rich-markdown-preview');
      assert.deepEqual(JSON.parse(rows[0].value),{'richMarkdownPreview.externalImageOrigins.v1':['https://trust-preview.invalid','https://saved-trust.invalid']});
    }finally{database.close();}
  }finally{assert.equal(path.dirname(directory),path.resolve('.test-results','host'));await fs.rm(directory,{recursive:true,force:true});}
});
