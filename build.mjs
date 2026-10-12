import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VS Code 1.95 ships Node 20.18 and Chromium 128 (updates/v1_95).
export const targets = { node: 'node20', browser: 'chrome128' };
const staticAssets = ['preview.css'];
const builds = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', external: ['vscode'] },
  { entryPoints: ['src/preview.ts'], outfile: 'dist/preview.js', platform: 'browser', format: 'iife' },
  { entryPoints: ['src/render.ts'], outfile: 'dist/render.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/tables.ts'], outfile: 'dist/tables.cjs', platform: 'node', format: 'cjs' }
];
export async function build({ root = process.cwd(), production = false, watch = false, logLevel = 'info' } = {}) {
  if (production && watch) throw new Error('Watch mode requires the development profile');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  // Remove only known build maps when switching profiles; never clean arbitrary files.
  if (production) {
    const { rm } = await import('node:fs/promises');
    for (const options of builds) await rm(path.join(root, `${options.outfile}.map`), { force: true });
  }
  const contexts = [];
  const dispose = async () => { await Promise.all(contexts.map(ctx => ctx.dispose())); };
  const bundledPackages = new Set();
  const assets = {
    absWorkingDir: root, entryPoints: staticAssets, write: false, logLevel,
    plugins: [{ name: 'copy-static-assets', setup(builder) {
      builder.onResolve({ filter: /./ }, args => ({ path: args.path, namespace: 'static' }));
      builder.onLoad({ filter: /./, namespace: 'static' }, async args => {
        const source = path.join(root, 'src', args.path);
        await copyFile(source, path.join(root, 'dist', args.path));
        console.log(`[assets] copied ${args.path}`);
        return { contents: '', loader: 'js', watchFiles: [source] };
      });
    } }]
  };
  try {
    for (const options of [...builds, assets]) {
      const config = options === assets ? assets : {
        ...options, absWorkingDir: root, target: targets[options.platform],
        bundle: true, minify: production, sourcemap: production ? false : true,
        logLevel, metafile: true
      };
      if (watch) {
        const ctx = await esbuild.context(config);
        contexts.push(ctx);
        await ctx.watch();
        await ctx.rebuild();
      } else {
        const result = await esbuild.build(config);
        if (!result.metafile) continue;
        for (const input of Object.keys(result.metafile.inputs)) {
          const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
          if (match) bundledPackages.add(match[1]);
        }
      }
    }
    if (production) {
      const notices = ['THIRD-PARTY SOFTWARE NOTICES', 'Generated from packages included in the Rich Markdown Preview JavaScript bundles.'];
      for (const directory of [...bundledPackages].sort()) {
        const manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
        notices.push(`\n${'='.repeat(72)}\n${manifest.name} ${manifest.version}\nLicense: ${JSON.stringify(manifest.license ?? manifest.licenses ?? 'See package notices')}`);
        const files = (await readdir(path.join(root, directory))).filter(file => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file));
        for (const file of files) {
          try { notices.push(`\n--- ${file} ---\n${await readFile(path.join(root, directory, file), 'utf8')}`); }
          catch (error) { if (error.code !== 'EISDIR') throw error; }
        }
      }
      await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n') + '\n');
    }
    return { dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--production', '--watch'].includes(arg))) throw new Error('Usage: node build.mjs [--production | --watch]');
  const session = await build({ production: args.includes('--production'), watch: args.includes('--watch') });
  if (args.includes('--watch')) {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await session.dispose();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log('[watch] ready');
  }
}
