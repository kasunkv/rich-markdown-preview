const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const manifest = require('../package.json');

exports.run = async () => {
  const workspace = process.env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE;
  const root = path.resolve(__dirname, '..');
  const mode = process.env.RICH_MARKDOWN_PREVIEW_TEST_TRUST;
  const output = process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT;
  assert.ok(['trusted', 'restricted', 'transition'].includes(mode));
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  assert.ok(normalize(workspace).startsWith(normalize(path.join(root, '.test-results', 'host')) + path.sep));
  const checks = [];
  let browser;
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out: ' + label);
  };
  const findFrame = async selector => {
    let found;
    await wait(async () => {
      for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) {
        try { if (await frame.locator(selector).count()) { found = frame; return true; } } catch {}
      }
      return false;
    }, selector);
    return found;
  };
  const grantFixtureTrust = async () => {
    assert.equal(vscode.workspace.isTrusted, false);
    await vscode.commands.executeCommand('workbench.trust.manage');
    let button;
    let trustEditor;
    await wait(async () => {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        const editor = page.locator('.workspace-trust-editor');
        if (!await editor.count()) continue;
        const candidate = editor.getByRole('button', {name: 'Trust', exact: true});
        if (await candidate.count() === 1) { button = candidate; trustEditor = editor; return true; }
      }
      return false;
    }, 'Native fixture Trust button');
    // The editor Trust action grants this fixture only. Never use the parent-folder action.
    assert.equal(await trustEditor.locator('input[type=checkbox]:checked, [role=checkbox][aria-checked=true]').count(), 0, 'No broader parent-folder trust checkbox is selected');
    checks.push('Native trust editor has no selected parent-folder checkbox; exact Trust action used');
    await button.click();
    await wait(() => vscode.workspace.isTrusted, 'Real Workspace Trust grant');
    assert.equal(vscode.workspace.workspaceFolders.length, 1);
    assert.equal(normalize(vscode.workspace.workspaceFolders[0].uri.fsPath), normalize(workspace));
    checks.push('Native Trust action granted only the isolated fixture workspace');
  };
  try {
    assert.equal(vscode.workspace.isTrusted, false, 'Fresh profile starts in actual Restricted Mode');
    checks.push('Real workspace.isTrusted=false in isolated profile');
    browser = await require('playwright').chromium.connectOverCDP('http://127.0.0.1:' + process.env.RICH_MARKDOWN_PREVIEW_DEBUG_PORT);
    if (mode === 'trusted') {
      await grantFixtureTrust();
      await require('./vscode-settings.cjs').run();
      const result = JSON.parse(await fs.readFile(output, 'utf8'));
      checks.push(...result.checks);
    } else {
      const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
      assert.ok(extension, 'Extension is registered in Restricted Mode');
      assert.equal(extension.packageJSON.capabilities.untrustedWorkspaces.supported, 'limited');
      for (const key of ['richMarkdownPreview.referenceRoot', 'markdownLens.referenceRoot', 'styledMarkdown.referenceRoot'])
        assert.ok(extension.packageJSON.capabilities.untrustedWorkspaces.restrictedConfigurations.includes(key));
      await extension.activate();
      checks.push('Limited capability declaration activates safe preview in Restricted Mode');
      await require('./vscode-trust-proof.cjs').prove({vscode, workspace, browser, findFrame, wait, checks, mode, grantFixtureTrust});
    }
    await fs.writeFile(output, JSON.stringify({passed:true,hostVersion:vscode.version,trustMode:mode,isTrusted:vscode.workspace.isTrusted,checks},null,2));
  } catch (error) {
    await fs.writeFile(output, JSON.stringify({passed:false,hostVersion:vscode.version,trustMode:mode,isTrusted:vscode.workspace.isTrusted,checks,error:String(error),stack:error.stack},null,2));
    throw error;
  } finally { if (browser) await browser.close(); }
};
