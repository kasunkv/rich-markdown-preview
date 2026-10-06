import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await copyFile('src/preview.css', 'dist/preview.css');
const builds = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', external: ['vscode'] },
  { entryPoints: ['src/preview.ts'], outfile: 'dist/preview.js', platform: 'browser', format: 'iife' },
  { entryPoints: ['src/render.ts'], outfile: 'dist/render.cjs', platform: 'node', format: 'cjs' }
];
for (const options of builds) {
  const config = { ...options, bundle: true, minify: true, sourcemap: false, logLevel: 'info' };
  if (process.argv.includes('--watch')) { const ctx = await esbuild.context(config); await ctx.watch(); }
  else await esbuild.build(config);
}
