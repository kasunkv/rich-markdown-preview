const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

test('release manifest exposes the agreed identity, icon, keywords and menus', () => {
  assert.equal(manifest.name,'rich-markdown-preview');
  assert.match(manifest.scripts.package,/--githubBranch master\b/);
  assert.equal(manifest.displayName,'Rich Markdown Preview - A Styled Markdown Preview');
  assert.equal(manifest.version,'1.1.0'); assert.equal(manifest.publisher,'kasunkodagoda');
  assert.equal(manifest.author.name,'Kasun Kodagoda');
  assert.ok(manifest.keywords.includes('markdown')); assert.ok(manifest.keywords.length <= 30);
  const icon = fs.readFileSync(path.resolve(__dirname,'..',manifest.icon));
  assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128);
  const command = manifest.contributes.commands.find(command => command.command === 'richMarkdownPreview.openPreview');
  assert.equal(command.title,'Open in Rich Markdown Preview');
  assert.ok(Object.keys(manifest.contributes.configuration.properties).every(key => key.startsWith('richMarkdownPreview.')));
  assert.ok(manifest.contributes.commands.every(command => command.command.startsWith('richMarkdownPreview.')));
  for (const location of ['editor/title','editor/context','explorer/context']) {
    assert.ok(manifest.contributes.menus[location].some(item => item.command === command.command && /markdown/.test(item.when)));
    assert.ok(manifest.contributes.menus[location][0].when.includes('resourceExtname =~ /\\.md$/i'));
  }
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /\) && !explorerResourceIsFolder$/);
  const shortcut = manifest.contributes.keybindings[0];
  assert.equal(shortcut.command, command.command);
  assert.equal(shortcut.key, 'ctrl+alt+m'); assert.equal(shortcut.mac, 'cmd+alt+m');
  assert.ok(shortcut.when.includes('editorTextFocus && ('));
  assert.ok(shortcut.when.includes('resourceExtname =~ /\\.md$/i'));
  assert.equal(manifest.contributes.configuration.properties['richMarkdownPreview.openPreviewToSide'].default, true);
  assert.equal(require('../package-lock.json').version,manifest.version);
  assert.equal(require('../package-lock.json').packages[''].name,manifest.name);
});

test('customer documentation assets and bundled licenses exist', () => {
  const readme = fs.readFileSync(path.resolve(__dirname,'../README.md'),'utf8');
  assert.match(readme,/Open in Rich Markdown Preview/); assert.match(readme,/Command Palette/);
  assert.doesNotMatch(readme,/npm install|npm run|Press \*\*F5/);
  const tokens = new (require('markdown-it'))().parse(readme, {});
  for (const token of tokens.flatMap(token => token.children ?? [])) {
    const asset = token.type === 'image' ? token.attrGet('src') : token.type === 'link_open' ? token.attrGet('href') : null;
    if (asset && !/^(https?:|#)/.test(asset)) assert.ok(fs.existsSync(path.resolve(__dirname,'..',asset)), asset);
  }
  const notices=fs.readFileSync(path.resolve(__dirname,'../THIRD_PARTY_NOTICES.txt'),'utf8');
  for (const name of ['markdown-it','highlight.js','mermaid']) assert.ok(notices.includes(name),name);
});
