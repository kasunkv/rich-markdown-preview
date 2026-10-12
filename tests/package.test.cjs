const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createVSIX } = require('@vscode/vsce');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { verifyVsix } = require('../scripts/verify-vsix.cjs');
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
  const clean = path.join(fixture, 'clean.vsix');
  await createVSIX({ cwd: fixture, packagePath: clean, dependencies: false, githubBranch: 'master' });
  const baseline = await verifyVsix(clean);
  const cli = require('node:child_process');
  const verifier = path.join(__dirname, '../scripts/verify-vsix.cjs');
  const cliResult = cli.spawnSync(process.execPath, [verifier, clean], { encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.equal(JSON.parse(cliResult.stdout).compressedBytes, baseline.compressedBytes);
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
  await rewriteZip(clean, bad, entries => [...entries, ['extension/research/private.html', Buffer.from('sentinel')]]);
  await assert.rejects(verifyVsix(bad), /unexpected:/);
  for (const key of ['name', 'publisher', 'version', 'main', 'icon']) {
    await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension/package.json' ? Buffer.from(JSON.stringify({ ...fixtureManifest, [key]: 'wrong' })) : data]));
    await assert.rejects(verifyVsix(bad), /manifest .* mismatch/);
  }
  await rewriteZip(clean, bad, entries => entries.map(([name, data]) => [name, name === 'extension.vsixmanifest' ? Buffer.from(data.toString().replace('Publisher="kasunkodagoda"', 'Publisher="wrong"')) : data]));
  await assert.rejects(verifyVsix(bad), /identity Publisher mismatch/);
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
  // A missing working-tree runtime asset must also fail after real packaging.
  await fs.unlink(path.join(fixture, 'dist/preview.css'));
  const missing = path.join(fixture, 'missing.vsix');
  await createVSIX({ cwd: fixture, packagePath: missing, dependencies: false, githubBranch: 'master', allowUnusedFilesPattern: true });
  await assert.rejects(verifyVsix(missing), /missing:.*preview.css/);
  console.log(`Package baseline: ${baseline.compressedBytes} ZIP bytes; ${baseline.uncompressedBytes} uncompressed bytes; ${baseline.inventory.length} paths`);
});
