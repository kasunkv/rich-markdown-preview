const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createVSIX } = require('@vscode/vsce');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { verifyVsix } = require('../scripts/verify-vsix.cjs');
const { verifyRelease } = require('../scripts/verify-release.cjs');
const manifest = require('../package.json');

async function rewriteZip(source, target, change) {
  const zip = new yazl.ZipFile();
  const entries = await new Promise((resolve, reject) => {
    yauzl.open(source, { lazyEntries: true }, (error, input) => {
      if (error) return reject(error);
      const result = [];
      input.on('error', reject);
      input.on('end', () => resolve(result));
      input.on('entry', entry => input.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = [];
        stream.on('error', reject);
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => { result.push([entry.fileName, Buffer.concat(chunks)]); input.readEntry(); });
      }));
      input.readEntry();
    });
  });
  for (const [name, data] of change(entries)) zip.addBuffer(data, name);
  const done = new Promise((resolve, reject) => {
    const output = require('node:fs').createWriteStream(target);
    output.on('close', resolve); output.on('error', reject);
    zip.outputStream.on('error', reject); zip.outputStream.pipe(output);
  });
  zip.end();
  await done;
}

test('actual VSIX excludes incidental files and rejects missing, extra, invalid and oversized contents', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'rich-markdown-package-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  for (const file of manifest.files) {
    const target = path.join(fixture, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(__dirname, '..', file), target);
  }
  for (const file of ['src', 'tests', 'scripts', 'samples', 'examples', '.vscode', 'DEVELOPMENT.md', 'build.mjs', 'tsconfig.json', 'package-lock.json']) {
    await fs.cp(path.join(__dirname, '..', file), path.join(fixture, file), { recursive: true });
  }
  // Fixture contains already-built assets; never run workspace hooks or install dependencies.
  const fixtureManifest = { ...manifest, scripts: {} };
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify(fixtureManifest));
  // Release checks exercise fixture notes, never demand release notes from a development checkout.
  await fs.writeFile(path.join(fixture, 'CHANGELOG.md'), `## ${manifest.version}\n\n- Release fixture notes\n`);
  const clean = path.join(fixture, 'clean.vsix');
  await createVSIX({ cwd: fixture, packagePath: clean, dependencies: false, githubBranch: 'master' });
  const baseline = await verifyVsix(clean);
  const cli = require('node:child_process');
  const verifier = path.join(__dirname, '../scripts/verify-vsix.cjs');
  const cliResult = cli.spawnSync(process.execPath, [verifier, clean], { encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.equal(JSON.parse(cliResult.stdout).compressedBytes, baseline.compressedBytes);
  const releaseVerifier = path.join(fixture, 'scripts/verify-release.cjs');
  const releaseCliOptions = { encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') } };
  const releaseCli = cli.spawnSync(process.execPath, [releaseVerifier, clean, '--tag', `v${manifest.version}`], releaseCliOptions);
  assert.equal(releaseCli.status, 0, releaseCli.stderr);
  assert.equal(JSON.parse(releaseCli.stdout).version, manifest.version);
  for (const args of [[clean, '--tag', 'v0.0.0'], ['--tag'], ['--unknown'], [clean, clean], ['--tag', `v${manifest.version}`, '--tag', `v${manifest.version}`]]) {
    const failed = cli.spawnSync(process.execPath, [releaseVerifier, ...args], releaseCliOptions);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Release tag mismatch|Usage:/);
  }
  for (const file of ['docs/private.html', 'docs/specs/private.md', 'specs/private.md', 'research/private.html', 'DEVELOPMENT.md', 'dist/test-only.js', 'dist/preview.js.map', 'assets/private.png']) {
    const target = path.join(fixture, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'PACKAGE SENTINEL');
  }
  const dirty = path.join(fixture, 'dirty.vsix');
  await createVSIX({ cwd: fixture, packagePath: dirty, dependencies: false, githubBranch: 'master' });
  const result = await verifyVsix(dirty);
  assert.deepEqual(result.inventory.map(entry => entry.file).sort(), baseline.inventory.map(entry => entry.file).sort());
  const bad = path.join(fixture, 'bad.vsix');
  for (const file of ['extension/dist/preview.js', 'extension/THIRD_PARTY_NOTICES.txt']) {
    await rewriteZip(clean, bad, entries => entries.filter(([name]) => name !== file));
    await assert.rejects(verifyVsix(bad), /missing:/);
  }
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/THIRD_PARTY_NOTICES.txt' ? Buffer.from('Missing license text') : data]));
  await assert.rejects(verifyVsix(bad), /notices hash mismatch/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/RUNTIME_DEPENDENCIES.json' ? Buffer.from('{}') : data]));
  await assert.rejects(verifyVsix(bad), /inventory differs from current/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/dist/preview.js' ? Buffer.from('stale build') : data]));
  await assert.rejects(verifyVsix(bad), /bundle hash mismatch/);
  await rewriteZip(clean, bad, entries => [...entries, ['extension/research/private.html', Buffer.from('sentinel')]]);
  await assert.rejects(verifyVsix(bad), /unexpected:/);
  for (const key of ['name', 'publisher', 'version', 'main', 'icon']) {
    await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/package.json' ? Buffer.from(JSON.stringify({ ...fixtureManifest, [key]: 'wrong' })) : data]));
    await assert.rejects(verifyVsix(bad), /manifest .* mismatch/);
  }
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension.vsixmanifest' ? Buffer.from(data.toString().replace('Publisher="kasunkodagoda"', 'Publisher="wrong"')) : data]));
  await assert.rejects(verifyVsix(bad), /identity Publisher mismatch/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension.vsixmanifest' ? Buffer.from(data.toString().replace(/(<Identity\s+[^>]*\bVersion=")[^"]*/, '$10.0.0')) : data]));
  await assert.rejects(verifyVsix(bad), /VSIX identity Version mismatch: expected/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/changelog.md' ? Buffer.from('## Unreleased\n\n- Future work') : data]));
  await assert.rejects(verifyRelease({ root: fixture, filename: bad }), /VSIX changelog: expected one release notes entry/);
  await fs.writeFile(path.join(fixture, 'CHANGELOG.md'), '## Unreleased\n\n- Development changes');
  await assert.rejects(verifyRelease({ root: fixture, filename: clean }), /CHANGELOG.md: expected one release notes entry/);
  await rewriteZip(clean, bad, entries => [...entries, entries[0]]);
  await assert.rejects(verifyVsix(bad), /Duplicate ZIP path/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/dist/preview.js' ? Buffer.alloc(0) : data]));
  await assert.rejects(verifyVsix(bad), /Empty required asset/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/dist/preview.js' ? Buffer.alloc(6500001) : data]));
  await assert.rejects(verifyVsix(bad), /Oversized ZIP entry/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/dist/preview.js' ? Buffer.alloc(6000000) : data]));
  await assert.rejects(verifyVsix(bad), /size budget exceeded/);
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/dist/preview.js' ? require('node:crypto').randomBytes(2100000) : data]));
  await assert.rejects(verifyVsix(bad), /size budget exceeded/);
  await fs.writeFile(bad, 'not a ZIP');
  await assert.rejects(verifyVsix(bad));
  const cliFailure = cli.spawnSync(process.execPath, [verifier, bad], { encoding: 'utf8' });
  assert.equal(cliFailure.status, 1);
  assert.ok(cliFailure.stderr.length > 0);
  // Bump an isolated source tree and regenerate real VSCE metadata without editing invariants.
  const bumpedManifest = { ...fixtureManifest, version: `${BigInt(manifest.version.split('.')[0]) + 1n}.1.2` };
  const bumpedLock = { ...require('../package-lock.json'), version: bumpedManifest.version,
    packages: { ...require('../package-lock.json').packages, '': { ...require('../package-lock.json').packages[''], version: bumpedManifest.version } } };
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify(bumpedManifest));
  await fs.writeFile(path.join(fixture, 'package-lock.json'), JSON.stringify(bumpedLock));
  await fs.writeFile(path.join(fixture, 'CHANGELOG.md'), `## ${bumpedManifest.version} — 2026-10-12\n\n- Intentional version bump fixture\n`);
  const bumped = path.join(fixture, `${manifest.name}-${bumpedManifest.version}.vsix`);
  await createVSIX({ cwd: fixture, packagePath: bumped, dependencies: false, githubBranch: 'master' });
  assert.equal((await verifyRelease({ root: fixture, tag: `v${bumpedManifest.version}` })).version, bumpedManifest.version);
  await assert.rejects(verifyRelease({ root: fixture, filename: clean }), /Packaged manifest version mismatch: expected/);
  for (const lock of [{ ...bumpedLock, version: '0.0.0' }, { ...bumpedLock, packages: { ...bumpedLock.packages, '': { version: '0.0.0' } } }]) {
    await fs.writeFile(path.join(fixture, 'package-lock.json'), JSON.stringify(lock));
    await assert.rejects(verifyRelease({ root: fixture, filename: bumped }), /package-lock.json .*version mismatch/);
  }
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify(fixtureManifest));
  // A missing working-tree runtime asset must also fail after real packaging.
  await fs.unlink(path.join(fixture, 'dist/preview.css'));
  const missing = path.join(fixture, 'missing.vsix');
  await createVSIX({ cwd: fixture, packagePath: missing, dependencies: false, githubBranch: 'master', allowUnusedFilesPattern: true });
  await assert.rejects(verifyVsix(missing), /missing:.*preview.css/);
  console.log(`Package baseline: ${baseline.compressedBytes} ZIP bytes; ${baseline.uncompressedBytes} uncompressed bytes; ${baseline.inventory.length} paths`);
});
