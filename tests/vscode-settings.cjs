const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.test-results', 'vscode-settings.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension('local-development.styled-markdown-preview');
    assert.ok(extension, 'Development extension is registered');
    await extension.activate();
    const uri = vscode.Uri.file(path.join(root, 'tests/fixtures/workspace/test.md'));
    const config = vscode.workspace.getConfiguration('styledMarkdown', uri);
    for (const [key, value] of Object.entries({style:'reading',appearance:'dark',contentWidth:720,fontSize:18,lineHeight:1.9,wrapCode:true})) {
      const previous = config.inspect(key)?.workspaceFolderValue;
      try {
        await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(vscode.workspace.getConfiguration('styledMarkdown', uri).get(key), value);
        checks.push(`${key}: folder save and read passed`);
      } finally {
        await config.update(key, previous, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
    await vscode.commands.executeCommand('styledMarkdown.openPreview', uri);
    checks.push('Preview command opened fixture');
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:true,checks},null,2));
  } catch (error) {
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:false,checks,error:String(error),stack:error.stack},null,2));
    throw error;
  }
};
