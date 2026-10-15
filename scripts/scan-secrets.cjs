const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = '8.30.0';
const linuxSha256 = '79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e';

async function main() {
  const directory = path.join(root, '.test-results', 'secret-scanning');
  fs.mkdirSync(directory, { recursive: true });
  let binary = process.env.GITLEAKS_BINARY;
  if (!binary) {
    if (process.platform !== 'linux' || process.arch !== 'x64')
      throw Error(`Set GITLEAKS_BINARY to a verified Gitleaks ${version} executable on this platform`);
    const response = await fetch(
      `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`,
      {
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok) throw Error('Gitleaks download failed');
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== linuxSha256) throw Error('Gitleaks checksum mismatch');
    const archive = path.join(directory, 'gitleaks.tar.gz');
    fs.writeFileSync(archive, data);
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', directory, 'gitleaks'], { stdio: 'inherit' });
    if (extracted.status !== 0) throw Error('Gitleaks extraction failed');
    binary = path.join(directory, 'gitleaks');
  }
  const installed = spawnSync(binary, ['version'], { encoding: 'utf8' });
  if (installed.status !== 0 || installed.stdout.trim() !== version) throw Error('Unexpected Gitleaks version');
  const scanned = spawnSync(
    binary,
    [
      'git',
      '--redact=100',
      '--no-banner',
      '--config',
      path.join(root, '.gitleaks.toml'),
      '--log-opts=--all',
      '--report-format',
      'json',
      '--report-path',
      path.join(directory, 'report.json'),
      root,
    ],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (scanned.status !== 0) throw Error('Secret scan failed; inspect the local redacted report');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
