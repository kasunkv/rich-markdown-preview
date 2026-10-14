const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = (data) => createHash('sha256').update(data).digest('hex');
function reviewException(item, now = new Date()) {
  if (
    !item ||
    !item.owner?.trim() ||
    !item.rationale?.trim() ||
    !item.approvedBy?.trim() ||
    !item.reviewUrl?.startsWith('https://')
  )
    throw new Error('Exception requires owner, rationale, approvedBy and reviewUrl');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(item.expires) ||
    !Number.isFinite(Date.parse(item.expires)) ||
    new Date(item.expires).toISOString().slice(0, 10) !== item.expires
  )
    throw new Error('Invalid exception expiry');
  if (now >= new Date(`${item.expires}T00:00:00Z`)) throw new Error(`Expired exception: ${item.expires}`);
}
async function generateRuntime(root, inputs, bundles, policy) {
  for (const exception of policy.exceptions) reviewException(exception);
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const directories = [
    ...new Set(
      inputs
        .map((input) => input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1])
        .filter(Boolean),
    ),
  ].sort();
  const components = [];
  const notices = [
    'THIRD-PARTY SOFTWARE NOTICES',
    'Generated from production inputs of the JavaScript bundles shipped in the VSIX.',
  ];
  for (const directory of directories) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, directory, 'package.json'), 'utf8'));
    const locked = lock.packages[directory];
    if (!locked || locked.version !== manifest.version || !locked.integrity)
      throw new Error(`Lockfile mismatch or missing integrity: ${directory}`);
    let license = manifest.license;
    const licenseSource = (policy.licenseSources || []).find(
      (item) => item.package === manifest.name && item.version === manifest.version,
    );
    if (licenseSource) {
      if (hash(await fs.readFile(path.join(root, directory, licenseSource.file), 'utf8')) !== licenseSource.sha256)
        throw new Error('Reviewed license metadata changed: ' + manifest.name);
      license = licenseSource.license;
    }
    const exception = policy.exceptions.find(
      (item) => item.package === manifest.name && item.version === manifest.version && item.license === license,
    );
    if (exception) reviewException(exception);
    else if (!policy.allowedLicenses.includes(license))
      throw new Error(`License review required: ${manifest.name} ${license}`);
    const texts = [];
    for (const file of (await fs.readdir(path.join(root, directory)))
      .filter((file) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file))
      .sort()) {
      const filename = path.join(root, directory, file);
      if (!(await fs.stat(filename)).isFile()) continue;
      const text = await fs.readFile(filename, 'utf8');
      if (text.trim()) texts.push({ file, text, sha256: hash(text) });
    }
    for (const source of (policy.textSources || []).filter(
      (item) => item.package === manifest.name && item.version === manifest.version,
    )) {
      const raw = await fs.readFile(path.join(root, directory, source.file), 'utf8');
      const parts = raw.split(source.after);
      const text = parts.length === 2 ? parts[1].trim() : '';
      if (!text || hash(text) !== source.sha256) throw new Error('Reviewed license text changed: ' + manifest.name);
      texts.push({ file: source.file + ' (license section)', text, sha256: hash(text) });
    }
    if (
      !texts.some(
        (item) => /^(licen[sc]e|copying)([.-]|$)/i.test(item.file) || item.file.endsWith(' (license section)'),
      )
    )
      throw new Error(`Missing required license text: ${manifest.name}`);
    const section = `\n${'='.repeat(72)}\n${manifest.name} ${manifest.version}\nLicense: ${license}\n${texts.map((item) => `\n--- ${item.file} ---\n${item.text}`).join('')}`;
    notices.push(section);
    components.push({
      name: manifest.name,
      version: manifest.version,
      purl: `pkg:npm/${manifest.name.replace('@', '%40')}@${manifest.version}`,
      lockPath: directory,
      integrity: locked.integrity,
      resolved: locked.resolved,
      license,
      licenseTexts: texts.map(({ text, ...item }) => item),
      noticeCharacters: section.length,
      noticeSha256: hash(section),
    });
  }
  const text = notices.join('\n') + '\n';
  const inventory = {
    schemaVersion: 1,
    scope: 'VSIX production JavaScript inputs (not build/test tooling)',
    lockfileSha256: hash(await fs.readFile(path.join(root, 'package-lock.json'))),
    bundles: await Promise.all(
      bundles.sort().map(async (file) => ({ file, sha256: hash(await fs.readFile(path.join(root, file))) })),
    ),
    noticesSha256: hash(text),
    components,
  };
  await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), text);
  await fs.writeFile(path.join(root, 'RUNTIME_DEPENDENCIES.json'), JSON.stringify(inventory, null, 2) + '\n');
  return inventory;
}
function verifyRuntime(entries, expected) {
  const get = (file) => {
    const entry = entries.get(`extension/${file}`);
    if (!entry) throw new Error(`Missing runtime artifact: ${file}`);
    return entry.data;
  };
  const inventoryBytes = get('RUNTIME_DEPENDENCIES.json');
  if (expected && !inventoryBytes.equals(expected))
    throw new Error('Packaged runtime inventory differs from current production build');
  const inventory = JSON.parse(inventoryBytes);
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.components) || !inventory.components.length)
    throw new Error('Invalid runtime inventory');
  const notices = get('THIRD_PARTY_NOTICES.txt');
  if (hash(notices) !== inventory.noticesSha256) throw new Error('Packaged notices hash mismatch');
  if (
    JSON.stringify(inventory.bundles.map((item) => item.file).sort()) !==
    JSON.stringify(require('../package.json').files.filter((file) => /^dist\/[^/]+\.(?:js|cjs)$/.test(file)).sort())
  )
    throw new Error('Invalid runtime bundle inventory');
  for (const bundle of inventory.bundles)
    if (hash(get(bundle.file)) !== bundle.sha256)
      throw new Error(`Packaged runtime bundle hash mismatch: ${bundle.file}`);
  for (const component of inventory.components) {
    const header = `\n${'='.repeat(72)}\n${component.name} ${component.version}\n`;
    const start = notices.toString().indexOf(header);
    const section = notices.toString().slice(start, start + component.noticeCharacters);
    if (start === -1 || hash(section) !== component.noticeSha256 || !component.licenseTexts.length)
      throw new Error(`Incomplete packaged notices: ${component.name}`);
  }
}
module.exports = { generateRuntime, verifyRuntime, reviewException, hash };
