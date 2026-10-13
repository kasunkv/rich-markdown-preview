const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SourceMap } = require('node:module');

async function eventually(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      // Output may be temporarily locked or replaced while the watcher writes.
      if (!['EBUSY', 'ENOENT'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Watcher did not update output within 10 seconds');
}

test('development maps source, watches CSS/TS replacements, disposes and switches to compact production', async t => {
  const { build } = await import('../build.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rich-markdown-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(path.join(__dirname, '../scripts/license-policy.json'), path.join(root, 'scripts/license-policy.json'));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {} }));
  const source = 'export function activate() {\n  console.log("breakpoint fixture");\n}\n';
  for (const file of ['extension.ts', 'preview.ts', 'render.ts', 'tables.ts', 'fragment-navigation.ts']) {
    await fs.writeFile(path.join(root, 'src', file), source);
  }
  const css = path.join(root, 'src/preview.css');
  const outputCss = path.join(root, 'dist/preview.css');
  await fs.writeFile(css, 'body { color: red; }');
  const session = await build({ root, watch: true, logLevel: 'silent' });
  t.after(() => session.dispose());
  const development = await fs.readFile(path.join(root, 'dist/extension.js'), 'utf8');
  const payload = JSON.parse(await fs.readFile(path.join(root, 'dist/extension.js.map'), 'utf8'));
  assert.deepEqual(payload.sourcesContent, [source]);
  const lines = development.split('\n');
  const line = lines.findIndex(value => value.includes('console.log("breakpoint fixture")'));
  const mapped = new SourceMap(payload).findEntry(line, lines[line].indexOf('console'));
  assert.equal(mapped.originalLine, 1);
  assert.match(mapped.originalSource, /src\/extension\.ts$/);
  assert.match(development, /sourceMappingURL=extension\.js\.map/);
  assert.equal(await fs.readFile(outputCss, 'utf8'), 'body { color: red; }');
  await fs.writeFile(css, 'body { color: blue; }');
  await eventually(async () => (await fs.readFile(outputCss, 'utf8')) === 'body { color: blue; }');
  // Editors commonly save by replacing the file, rather than writing in place.
  await fs.writeFile(`${css}.tmp`, 'body { color: green; }');
  await fs.rename(`${css}.tmp`, css);
  await eventually(async () => (await fs.readFile(outputCss, 'utf8')) === 'body { color: green; }');
  await fs.writeFile(path.join(root, 'src/extension.ts'), source.replace('breakpoint fixture', 'updated fixture'));
  await eventually(async () => (await fs.readFile(path.join(root, 'dist/extension.js'), 'utf8')).includes('updated fixture'));
  await session.dispose();
  await fs.writeFile(css, 'body { color: purple; }');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await fs.readFile(outputCss, 'utf8'), 'body { color: green; }');
  await build({ root, production: true, logLevel: 'silent' });
  for (const file of ['extension.js', 'preview.js', 'render.cjs', 'tables.cjs', 'fragment-navigation.cjs']) {
    await assert.rejects(fs.access(path.join(root, 'dist', `${file}.map`)), { code: 'ENOENT' });
    assert.doesNotMatch(await fs.readFile(path.join(root, 'dist', file), 'utf8'), /sourceMappingURL/);
  }
  assert.ok((await fs.stat(path.join(root, 'dist/extension.js'))).size < Buffer.byteLength(development));
  assert.equal(await fs.readFile(outputCss, 'utf8'), 'body { color: purple; }');
  assert.match(await fs.readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), /THIRD-PARTY SOFTWARE NOTICES/);
  await assert.rejects(build({ root, watch: true, production: true }), /development profile/);
});

test('failed watch startup disposes contexts already started', async t => {
  const { build } = await import('../build.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rich-markdown-build-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/extension.ts'), 'export const value = "initial";');
  await fs.writeFile(path.join(root, 'src/preview.ts'), 'export const = invalid syntax;');
  await assert.rejects(build({ root, watch: true, logLevel: 'silent' }), /Build failed/);
  const output = path.join(root, 'dist/extension.js');
  const before = await fs.readFile(output, 'utf8');
  await fs.writeFile(path.join(root, 'src/extension.ts'), 'export const value = "changed";');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await fs.readFile(output, 'utf8'), before);
});
