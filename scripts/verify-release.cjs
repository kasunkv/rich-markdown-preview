const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseVersion } = require('./release-version.cjs');
const { verifyVsix } = require('./verify-vsix.cjs');

async function verifyRelease({ root = path.resolve(__dirname, '..'), filename, tag } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const version = validateReleaseVersion({ manifest, lock, changelog, tag, release: true });
  const vsix = await verifyVsix(filename || path.join(root, `${manifest.name}-${manifest.version}.vsix`), { manifest, release: true });
  return { ...version, vsix };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let filename, tag;
  try {
    while (args.length) {
      const arg = args.shift();
      if (arg === '--tag' && tag === undefined && args[0] && !args[0].startsWith('--')) tag = args.shift();
      else if (!arg.startsWith('--') && filename === undefined) filename = arg;
      else throw new Error('Usage: verify-release.cjs [candidate.vsix] [--tag v<manifest-version>]');
    }
    verifyRelease({ filename, tag }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(error.message); process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}

module.exports = { verifyRelease };
