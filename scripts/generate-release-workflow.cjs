const fs = require('node:fs');
const path = require('node:path');
async function generate() {
  const root = path.resolve(__dirname, '..');
  const runtime = fs.readFileSync(path.join(root, '.github/release-runtime.cjs'), 'utf8').trimEnd();
  const template = fs.readFileSync(path.join(root, '.github/release-workflow.template'), 'utf8');
  const source = template.replaceAll(
    '          // RELEASE_RUNTIME',
    runtime
      .split(/\r?\n/)
      .map((line) => '          ' + line)
      .join('\n'),
  );
  const prettier = await import('prettier');
  const result = await prettier.format(source, {
    ...(await prettier.resolveConfig(path.join(root, '.github/workflows/release.yml'))),
    parser: 'yaml',
  });
  const file = path.join(root, '.github/workflows/release.yml');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== result)
      throw Error('Release workflow runtime drift; run node scripts/generate-release-workflow.cjs');
  } else fs.writeFileSync(file, result);
}
generate().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
