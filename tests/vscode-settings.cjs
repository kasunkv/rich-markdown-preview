const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const manifest = require('../package.json');
const { validateVersion } = require('../scripts/release-version.cjs');

exports.run = async function () {
  const waitUntil = async (predicate, message) => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(predicate(), message);
  };
  const waitForWebview = async () => {
    const deadline = Date.now() + 5000;
    while (!(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
  };
  const root = path.resolve(__dirname, '..');
  const workspace = process.env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE;
  const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  assert.ok(workspace && normalized(workspace).startsWith(normalized(path.join(root, '.test-results', 'host')) + path.sep), 'Use scripts/vscode-host.cjs with an isolated fixture');
  const output = process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT || path.join(root, '.test-results', 'vscode-settings.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'Development extension is registered');
    if (process.env.RICH_MARKDOWN_PREVIEW_TEST_MODE === 'package') {
      assert.ok(normalized(extension.extensionPath).startsWith(normalized(process.env.RICH_MARKDOWN_PREVIEW_TEST_EXTENSIONS) + path.sep), 'Target loaded from installed VSIX, not development checkout');
    } else assert.equal(normalized(extension.extensionPath), normalized(root));
    await extension.activate();
    assert.equal(extension.packageJSON.displayName, 'Rich Markdown Preview - A Styled Markdown Preview');
    validateVersion(extension.packageJSON.version, 'Registered extension version');
    assert.equal(extension.packageJSON.version, manifest.version, 'Registered extension version matches source manifest');
    assert.equal(extension.packageJSON.name, manifest.name);
    assert.equal(extension.packageJSON.publisher, manifest.publisher);
    assert.equal(extension.packageJSON.contributes.commands[0].title, 'Open in Rich Markdown Preview');
    assert.ok((await vscode.commands.getCommands()).includes('richMarkdownPreview.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('richMarkdownPreview.openDocumentationHome'));
    assert.ok((await vscode.commands.getCommands()).includes('styledMarkdown.openPreview'));
    assert.ok((await vscode.commands.getCommands()).includes('markdownLens.openPreview'));
    assert.ok(Object.keys(extension.packageJSON.contributes.configuration.properties).every(key => key.startsWith('richMarkdownPreview.')));
    assert.ok(await fs.stat(path.join(extension.extensionPath, extension.packageJSON.icon)));
    checks.push('Release identity, registered command label, and packaged icon verified');
    const uri = vscode.Uri.file(path.join(workspace, 'test.md'));
    for (const asset of ['dist/extension.js', 'dist/preview.js', 'dist/preview.css', extension.packageJSON.icon]) {
      assert.ok((await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, asset))).size > 0, `Host can read runtime resource ${asset}`);
    }
    checks.push('Runtime scripts, CSS and icon readable through host URI filesystem');
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
    // Wait for and close side panels before testing a fresh current-group panel.
    await waitForWebview();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await config.update('openPreviewToSide', false, vscode.ConfigurationTarget.WorkspaceFolder);
    const special = vscode.Uri.file(path.join(workspace, 'URI space # percent % café.md'));
    assert.ok(special.toString().includes('%23'));
    const previews = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview);
    await waitUntil(() => previews().length === 0, 'All prior panels disposed');
    for (const target of [uri, special]) {
      await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
      await waitUntil(() => vscode.window.tabGroups.activeTabGroup.activeTab?.label === `Rich Markdown Preview: ${path.basename(target.fsPath)}`, 'Selected document panel active');
    }
    assert.equal(previews().length, 2, 'Two distinct document panels');
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview', uri);
    await waitForWebview();
    assert.equal(previews().length, 2, 'Reopening existing document reuses panel');
    const edit = new vscode.WorkspaceEdit();
    edit.insert(special, new vscode.Position(0, 0), '# Edited in host\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await (await vscode.workspace.openTextDocument(special)).save());
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitUntil(() => previews().length === 0, 'Edited document panels disposed');
    for (const target of [special, uri]) {
      await vscode.commands.executeCommand('richMarkdownPreview.openPreview', target);
      await waitUntil(() => vscode.window.tabGroups.activeTabGroup.activeTab?.label === `Rich Markdown Preview: ${path.basename(target.fsPath)}`, 'Reopened document panel active');
    }
    assert.equal(previews().length, 2, 'Disposed panels reopen independently');
    checks.push('Encoded URI, multiple documents, live edit/save, reuse and disposal/reopen passed');
    if (process.env.RICH_MARKDOWN_PREVIEW_FORCE_FAILURE === '1') throw new Error('Forced host failure fixture');
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:true,hostVersion:vscode.version,checks},null,2));
  } catch (error) {
    await fs.mkdir(path.dirname(output), {recursive:true});
    await fs.writeFile(output, JSON.stringify({passed:false,hostVersion:vscode.version,checks,error:String(error),stack:error.stack},null,2));
    throw error;
  }
};
