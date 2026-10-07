const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const root = path.resolve(__dirname, '..');
  const output = process.env.MARKDOWN_LENS_TEST_RESULT || path.join(root, '.test-results', 'vscode-settings.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension(`${require('../package.json').publisher}.${require('../package.json').name}`);
    assert.ok(extension, 'Development extension is registered');
    await extension.activate();
    assert.equal(extension.packageJSON.displayName, 'Markdown Lens - A Styled Markdown Preview');
    assert.equal(extension.packageJSON.version, '1.0.0');
    assert.equal(extension.packageJSON.contributes.commands[0].title, 'Open in Markdown Lens');
    assert.ok((await vscode.commands.getCommands()).includes('markdownLens.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('styledMarkdown.openPreview'));
    assert.ok(Object.keys(extension.packageJSON.contributes.configuration.properties).every(key => key.startsWith('markdownLens.')));
    assert.ok(await fs.stat(path.join(extension.extensionPath, extension.packageJSON.icon)));
    checks.push('Release identity, registered command label, and packaged icon verified');
    const uri = vscode.Uri.file(path.join(root, 'tests/fixtures/workspace/test.md'));
    const config = vscode.workspace.getConfiguration('markdownLens', uri);
    for (const [key, value] of Object.entries({style:'reading',appearance:'dark',contentWidth:720,fontSize:18,lineHeight:1.9,wrapCode:true})) {
      const previous = config.inspect(key)?.workspaceFolderValue;
      try {
        await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(vscode.workspace.getConfiguration('markdownLens', uri).get(key), value);
        checks.push(`${key}: folder save and read passed`);
      } finally {
        await config.update(key, previous, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
    await vscode.commands.executeCommand('markdownLens.openPreview', uri);
    await vscode.commands.executeCommand('styledMarkdown.openPreview', uri);
    for (const style of extension.packageJSON.contributes.configuration.properties['markdownLens.style'].enum) {
      const previous = config.inspect('style')?.workspaceFolderValue;
      try {
        await config.update('style', style, vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(vscode.workspace.getConfiguration('markdownLens', uri).get('style'), style);
        checks.push(`Style ${style}: folder save and read passed`);
      } finally {
        await config.update('style', previous, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
    checks.push('Preview command opened fixture');
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:true,checks},null,2));
  } catch (error) {
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:false,checks,error:String(error),stack:error.stack},null,2));
    throw error;
  }
};
