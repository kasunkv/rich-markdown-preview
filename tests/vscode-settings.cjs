const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function () {
  const waitForWebview = async () => {
    const deadline = Date.now() + 5000;
    while (!(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
  };
  const root = path.resolve(__dirname, '..');
  const output = process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT || path.join(root, '.test-results', 'vscode-settings.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension(`${require('../package.json').publisher}.${require('../package.json').name}`);
    assert.ok(extension, 'Development extension is registered');
    await extension.activate();
    assert.equal(extension.packageJSON.displayName, 'Rich Markdown Preview - A Styled Markdown Preview');
    assert.equal(extension.packageJSON.version, '2.0.0');
    assert.equal(extension.packageJSON.contributes.commands[0].title, 'Open in Rich Markdown Preview');
    assert.ok((await vscode.commands.getCommands()).includes('richMarkdownPreview.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('richMarkdownPreview.openDocumentationHome'));
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
      await waitForWebview();
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, group.viewColumn);
      assert.equal(vscode.window.tabGroups.all.length, groupCount);
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('richMarkdownPreview.openPreview', uri);
      await waitForWebview();
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
    const currentGroup = vscode.window.tabGroups.activeTabGroup;
    const beforeHome = vscode.window.tabGroups.all.length;
    await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
    await waitForWebview();
    const homeDeadline = Date.now() + 5000;
    while (vscode.window.tabGroups.activeTabGroup.activeTab?.label !== 'Documentation Home' && Date.now() < homeDeadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, currentGroup.viewColumn);
    assert.equal(vscode.window.tabGroups.all.length, beforeHome);
    const homeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(homeTab.input instanceof vscode.TabInputWebview);
    assert.equal(homeTab.label, 'Documentation Home');
    const tabsBefore = vscode.window.tabGroups.all.reduce((sum, group) => sum + group.tabs.length, 0);
    await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
    assert.equal(vscode.window.tabGroups.all.reduce((sum, group) => sum + group.tabs.length, 0), tabsBefore);
    checks.push('Documentation Home command opens and reuses a webview in the active group without a split');
    // Exercise the same discovery API with real hidden and nested files.
    const fixtureRoot = vscode.workspace.getWorkspaceFolder(uri);
    const discovered = await vscode.workspace.findFiles(new vscode.RelativePattern(fixtureRoot, config.get('documentation.include')), config.get('documentation.exclude'));
    assert.ok(discovered.some(item => item.path.endsWith('/.claude/nested/guide.md')));
    assert.ok(discovered.some(item => item.path.endsWith('/reports/nested/report.MD')));
    assert.ok(!discovered.some(item => item.path.includes('/node_modules/')));
    checks.push('Real workspace search includes hidden and nested Markdown with explicit excludes');
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:true,checks},null,2));
  } catch (error) {
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:false,checks,error:String(error),stack:error.stack},null,2));
    throw error;
  }
};
