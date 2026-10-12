const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const manifest = require('../package.json');
const budget = require('./vsix-budget.json');
const { validateVersion, validateReleaseNotes } = require('./release-version.cjs');

function readZip(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => {
        if (entries.has(entry.fileName)) {
          zip.close();
          return reject(new Error(`Duplicate ZIP path: ${entry.fileName}`));
        }
        if (entry.uncompressedSize > budget.uncompressedBytes) {
          zip.close();
          return reject(new Error(`Oversized ZIP entry: ${entry.fileName}`));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { zip.close(); return reject(error); }
          const chunks = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, { data: Buffer.concat(chunks), compressed: entry.compressedSize, uncompressed: entry.uncompressedSize });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function verifyVsix(filename, { manifest: sourceManifest = manifest, release = false } = {}) {
  const manifest = sourceManifest;
  validateVersion(manifest.version);
  const entries = await readZip(filename);
  // VSCE normalizes customer document names in the ZIP.
  const normalized = { 'README.md': 'readme.md', 'CHANGELOG.md': 'changelog.md', LICENSE: 'LICENSE.txt' };
  const expected = new Set(['[Content_Types].xml', 'extension.vsixmanifest', ...manifest.files.map(file => `extension/${normalized[file] || file}`)]);
  const unexpected = [...entries.keys()].filter(file => !expected.has(file));
  const missing = [...expected].filter(file => !entries.has(file));
  if (unexpected.length || missing.length) throw new Error(`VSIX inventory mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}`);
  for (const [file, entry] of entries) {
    if (!entry.uncompressed) throw new Error(`Empty required asset: ${file}`);
  }
  const packaged = JSON.parse(entries.get('extension/package.json').data.toString('utf8'));
  for (const key of ['name', 'publisher', 'version', 'main', 'icon']) {
    if (packaged[key] !== manifest[key]) throw new Error(`Packaged manifest ${key} mismatch: expected ${manifest[key]}; got ${JSON.stringify(packaged[key])}`);
  }
  const main = packaged.main.replace(/^\.\//, '');
  if (!entries.has(`extension/${main}`)) throw new Error('Missing manifest entrypoint');
  const xml = entries.get('extension.vsixmanifest').data.toString('utf8');
  const identity = xml.match(/<Identity\s+([^>]+)\/?\s*>/);
  for (const [key, value] of Object.entries({ Id: manifest.name, Publisher: manifest.publisher, Version: manifest.version })) {
    const actual = identity?.[1].match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
    if (actual !== value) throw new Error(`VSIX identity ${key} mismatch: expected ${value}; got ${JSON.stringify(actual)}`);
  }
  if (release) validateReleaseNotes(entries.get('extension/changelog.md').data.toString('utf8'), manifest.version, 'VSIX changelog');
  const compressedBytes = fs.statSync(filename).size;
  const uncompressedBytes = [...entries.values()].reduce((sum, entry) => sum + entry.uncompressed, 0);
  if (compressedBytes > budget.compressedBytes || uncompressedBytes > budget.uncompressedBytes) throw new Error(`VSIX size budget exceeded: ${compressedBytes} compressed / ${uncompressedBytes} uncompressed bytes`);
  return { filename: path.resolve(filename), compressedBytes, uncompressedBytes, budget, inventory: [...entries].map(([file, entry]) => ({ file, compressedBytes: entry.compressed, uncompressedBytes: entry.uncompressed })) };
}

if (require.main === module) {
  const filename = process.argv[2] || `${manifest.name}-${manifest.version}.vsix`;
  verifyVsix(filename).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyVsix };
