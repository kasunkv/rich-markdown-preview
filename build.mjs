import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist', { recursive: true });
await copyFile('src/preview.css', 'dist/preview.css');
const builds = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', external: ['vscode'] },
  { entryPoints: ['src/preview.ts'], outfile: 'dist/preview.js', platform: 'browser', format: 'iife' },
  { entryPoints: ['src/render.ts'], outfile: 'dist/render.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/tables.ts'], outfile: 'dist/tables.cjs', platform: 'node', format: 'cjs' }
];
const bundledPackages = new Set();
for (const options of builds) {
  const config = { ...options, bundle: true, minify: true, sourcemap: false, logLevel: 'info', metafile: true };
  if (process.argv.includes('--watch')) { const ctx = await esbuild.context(config); await ctx.watch(); }
  else {
    const result = await esbuild.build(config);
    for (const input of Object.keys(result.metafile.inputs)) {
      const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (match) bundledPackages.add(match[1]);
    }
  }
}
if (!process.argv.includes('--watch')) {
  const notices = ['THIRD-PARTY SOFTWARE NOTICES', 'Generated from packages included in the Markdown Lens JavaScript bundles.'];
  for (const directory of [...bundledPackages].sort()) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    notices.push(`\n${'='.repeat(72)}\n${manifest.name} ${manifest.version}\nLicense: ${JSON.stringify(manifest.license ?? manifest.licenses ?? 'See package notices')}`);
    const files = (await readdir(directory)).filter(file => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file));
    for (const file of files) {
      try { notices.push(`\n--- ${file} ---\n${await readFile(path.join(directory, file), 'utf8')}`); }
      catch (error) { if (error.code !== 'EISDIR') throw error; }
    }
  }
  await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n') + '\n');
}
