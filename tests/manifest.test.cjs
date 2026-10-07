const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

test('release manifest exposes the agreed identity, icon, keywords and menus', () => {
  assert.equal(manifest.name,'markdown-lens');
  assert.equal(manifest.displayName,'Markdown Lens - A Styled Markdown Preview');
  assert.equal(manifest.version,'1.0.0'); assert.equal(manifest.publisher,'kasunkodagoda');
  assert.equal(manifest.author.name,'Kasun Kodagoda');
  assert.ok(manifest.keywords.includes('markdown')); assert.ok(manifest.keywords.length <= 30);
  const icon = fs.readFileSync(path.resolve(__dirname,'..',manifest.icon));
  assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128);
  const command = manifest.contributes.commands.find(command => command.command === 'markdownLens.openPreview');
  assert.equal(command.title,'Open in Markdown Lens');
  assert.ok(Object.keys(manifest.contributes.configuration.properties).every(key => key.startsWith('markdownLens.')));
  assert.ok(manifest.contributes.commands.every(command => command.command.startsWith('markdownLens.')));
  for (const location of ['editor/title','editor/context','explorer/context']) {
    assert.ok(manifest.contributes.menus[location].some(item => item.command === command.command && /markdown/.test(item.when)));
  }
  assert.equal(require('../package-lock.json').version,manifest.version);
  assert.equal(require('../package-lock.json').packages[''].name,manifest.name);
});

test('customer documentation assets and bundled licenses exist', () => {
  const readme = fs.readFileSync(path.resolve(__dirname,'../README.md'),'utf8');
  assert.match(readme,/Open in Markdown Lens/); assert.match(readme,/Command Palette/);
  assert.doesNotMatch(readme,/npm install|npm run|Press \*\*F5/);
  for (const [,asset] of readme.matchAll(/\]\(([^)]+)\)/g)) {
    if (!/^https?:/.test(asset)) assert.ok(fs.existsSync(path.resolve(__dirname,'..',asset)), asset);
  }
  const notices=fs.readFileSync(path.resolve(__dirname,'../THIRD_PARTY_NOTICES.txt'),'utf8');
  for (const name of ['markdown-it','highlight.js','mermaid']) assert.ok(notices.includes(name),name);
});
