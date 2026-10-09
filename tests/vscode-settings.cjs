const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const root = path.resolve(__dirname, '..');
  const output = process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT || path.join(root, '.test-results', 'vscode-settings.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension(`${require('../package.json').publisher}.${require('../package.json').name}`);
    assert.ok(extension, 'Development extension is registered');
    await extension.activate();
    assert.equal(extension.packageJSON.displayName, 'Rich Markdown Preview - A Styled Markdown Preview');
    assert.equal(extension.packageJSON.version, '1.1.0');
    assert.equal(extension.packageJSON.contributes.commands[0].title, 'Open in Rich Markdown Preview');
    assert.ok((await vscode.commands.getCommands()).includes('richMarkdownPreview.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('styledMarkdown.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('markdownLens.openPreview'));
    assert.ok(Object.keys(extension.packageJSON.contributes.configuration.properties).every(key => key.startsWith('richMarkdownPreview.')));
    assert.ok(await fs.stat(path.join(extension.extensionPath, extension.packageJSON.icon)));
    checks.push('Release identity, registered command label, and packaged icon verified');
    const uri = vscode.Uri.file(path.join(root, 'tests/fixtures/workspace/test.md'));
    const config = vscode.workspace.getConfiguration('richMarkdownPreview', uri);
    for (const [key, value] of Object.entries({style:'reading',appearance:'dark',contentWidth:720,fontSize:18,lineHeight:1.9,wrapCode:true})) {
      const previous = config.inspect(key)?.workspaceFolderValue;
      try {
        await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(vscode.workspace.getConfiguration('richMarkdownPreview', uri).get(key), value);
        checks.push(`${key}: folder save and read passed`);
      } finally {
        await config.update(key, previous, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    }
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview', uri);
    await vscode.commands.executeCommand('styledMarkdown.openPreview', uri);
    await vscode.commands.executeCommand('markdownLens.openPreview', uri);
    const previousPlacement = config.inspect('openPreviewToSide')?.workspaceFolderValue;
    let document = await vscode.workspace.openTextDocument(uri);
    const previousLanguage = document.languageId;
    try {
      document = await vscode.languages.setTextDocumentLanguage(document, 'plaintext');
      await config.update('openPreviewToSide', false, vscode.ConfigurationTarget.WorkspaceFolder);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      const group = vscode.window.tabGroups.activeTabGroup;
      const groupCount = vscode.window.tabGroups.all.length;
      await vscode.commands.executeCommand('richMarkdownPreview.openPreview', uri);
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, group.viewColumn);
      assert.equal(vscode.window.tabGroups.all.length, groupCount);
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('richMarkdownPreview.openPreview', uri);
      assert.equal(vscode.window.tabGroups.all.length, groupCount);
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview);
      checks.push('Plaintext md file opens and reuses a preview in the active group without creating a split');
    } finally {
      await config.update('openPreviewToSide', previousPlacement, vscode.ConfigurationTarget.WorkspaceFolder);
      await vscode.languages.setTextDocumentLanguage(document, previousLanguage);
    }
    for (const style of extension.packageJSON.contributes.configuration.properties['richMarkdownPreview.style'].enum) {
      const previous = config.inspect('style')?.workspaceFolderValue;
      try {
        await config.update('style', style, vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(vscode.workspace.getConfiguration('richMarkdownPreview', uri).get('style'), style);
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
