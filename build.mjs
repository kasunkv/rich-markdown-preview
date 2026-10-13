import * as esbuild from 'esbuild';
import coverageTools from './scripts/coverage-instrument.cjs';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dependencyPolicy from './scripts/dependency-policy.cjs';

// VS Code 1.95 ships Node 20.18 and Chromium 128 (updates/v1_95).
export const targets = { node: 'node20', browser: 'chrome128' };
const staticAssets = ['preview.css'];
const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  { entryPoints: ['src/preview.ts'], outfile: 'dist/preview.js', platform: 'browser', format: 'iife' },
  { entryPoints: ['src/render.ts'], outfile: 'dist/render.cjs', platform: 'node', format: 'cjs' },
  { entryPoints: ['src/tables.ts'], outfile: 'dist/tables.cjs', platform: 'node', format: 'cjs' },
];
export async function build({
  root = process.cwd(),
  production = false,
  watch = false,
  coverage = false,
  logLevel = 'info',
} = {}) {
  if (production && watch) throw new Error('Watch mode requires the development profile');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  // Remove only known build maps when switching profiles; never clean arbitrary files.
  if (production) {
    const { rm } = await import('node:fs/promises');
    for (const options of builds) await rm(path.join(root, `${options.outfile}.map`), { force: true });
  }
  const inventory = {};
  const coveragePlugin = {
    name: 'first-party-source-coverage',
    setup(builder) {
      builder.onLoad({ filter: /[.]ts$/ }, async (args) => {
        if (!args.path.startsWith(path.join(root, 'src') + path.sep) || args.path.endsWith('.d.ts')) return;
        const result = coverageTools.instrument(args.path);
        return {
          contents:
            result.code +
            '\n//# sourceMappingURL=data:application/json;base64,' +
            Buffer.from(JSON.stringify(result.map)).toString('base64'),
          loader: 'ts',
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
  if (coverage) {
    if (production || watch || !process.env.SOURCE_COVERAGE_ROOT)
      throw new Error('Coverage requires a development one-shot build and SOURCE_COVERAGE_ROOT');
    for (const file of coverageTools.sources(path.join(root, 'src')))
      inventory[file] = coverageTools.instrument(file).coverage;
    await mkdir(process.env.SOURCE_COVERAGE_ROOT, { recursive: true });
    await writeFile(path.join(process.env.SOURCE_COVERAGE_ROOT, 'inventory.json'), JSON.stringify(inventory));
  }
  const contexts = [];
  const dispose = async () => {
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  };
  const productionInputs = new Set();
  const assets = {
    absWorkingDir: root,
    entryPoints: staticAssets,
    write: false,
    logLevel,
    plugins: [
      {
        name: 'copy-static-assets',
        setup(builder) {
          builder.onResolve({ filter: /./ }, (args) => ({ path: args.path, namespace: 'static' }));
          builder.onLoad({ filter: /./, namespace: 'static' }, async (args) => {
            const source = path.join(root, 'src', args.path);
            await copyFile(source, path.join(root, 'dist', args.path));
            console.log(`[assets] copied ${args.path}`);
            return { contents: '', loader: 'js', watchFiles: [source] };
          });
        },
      },
    ],
  };
  try {
    for (const options of [...builds, assets]) {
      const config =
        options === assets
          ? assets
          : {
              ...options,
              absWorkingDir: root,
              target: targets[options.platform],
              bundle: true,
              minify: production,
              sourcemap: production ? false : true,
              logLevel,
              metafile: true,
              plugins: coverage ? [coveragePlugin] : [],
            };
      if (watch) {
        const ctx = await esbuild.context(config);
        contexts.push(ctx);
        await ctx.watch();
        await ctx.rebuild();
      } else {
        const result = await esbuild.build(config);
        if (!result.metafile) continue;
        if (['dist/extension.js', 'dist/preview.js'].includes(options.outfile)) {
          for (const input of Object.keys(result.metafile.inputs)) productionInputs.add(input);
        }
      }
    }
    if (production) {
      const policy = JSON.parse(await readFile(path.join(root, 'scripts/license-policy.json'), 'utf8'));
      await dependencyPolicy.generateRuntime(
        root,
        [...productionInputs],
        ['dist/extension.js', 'dist/preview.js'],
        policy,
      );
    }
    return { dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--production', '--watch', '--coverage'].includes(arg)))
    throw new Error('Usage: node build.mjs [--production | --watch]');
  const session = await build({
    production: args.includes('--production'),
    watch: args.includes('--watch'),
    coverage: args.includes('--coverage'),
  });
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
