const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise VS Code's own webview Find widget through the real workbench keyboard path.
exports.proveFind = async ({ vscode, workspace, findFrame, checks }) => {
  assert.equal(process.platform, 'win32', 'This smoke covers Windows Ctrl+F only');
  const directory = path.join(workspace, 'find-proof');
  await fs.mkdir(directory, { recursive: true });
  const first = path.join(directory, 'find-first.md');
  const second = path.join(directory, 'find-second.md');
  await fs.writeFile(
    first,
    '# Find proof\n\nFIND_VISIBLE_ALPHA\n\n| State | Value |\n| --- | --- |\n| shown | TABLE_VISIBLE_ALPHA |\n| omitted | TABLE_HIDDEN_BETA |\n\n<table><tbody><tr><td><details><summary>Closed disclosure</summary>DISCLOSURE_HIDDEN_GAMMA</details></td></tr></tbody></table>\n\n```mermaid\ngraph TD\n A[DIAGRAM_SOURCE_DELTA] -->\n```\n',
  );
  await fs.writeFile(second, '# Second Find proof\n\nFIND_VISIBLE_OMEGA\n');

  const openFind = async (frame, phrase) => {
    assert.ok(
      vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview,
      'Ctrl+F is tested while the preview webview is the active editor',
    );
    const page = frame.page();
    await frame.locator('body').click();
    await page.keyboard.press('Control+f');
    const widget = page.locator('.find-widget');
    await widget.waitFor({ state: 'visible', timeout: 10000 });
    const input = widget.locator('input').first();
    await input.fill(phrase);
    await page.waitForTimeout(150);
    const count = widget.locator('.matchesCount');
    await count.waitFor({ state: 'visible', timeout: 5000 });
    const result = (await count.innerText()).trim();
    assert.match(result, /[1-9]/, `Find widget matched ${phrase}`);
    return { page, widget, result: result.replace(/\s+/g, ' ').trim() };
  };
  const closeFind = async (page) => page.keyboard.press('Escape');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openPreview', vscode.Uri.file(first));
  let frame = await findFrame('#rmp-ui-content');
  let result = await openFind(frame, 'FIND_VISIBLE_ALPHA');
  checks.push({ mode: 'single-file', keyboard: 'Ctrl+F', result: result.result });
  await closeFind(result.page);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
  frame = await findFrame('input[aria-label="Filter documentation files or folders"]');
  const fileFilter = frame.locator('input[aria-label="Filter documentation files or folders"]');
  await fileFilter.fill('FIND_VISIBLE_ALPHA');
  await frame.waitForFunction(() => document.querySelector('.documentation-notice')?.textContent?.startsWith('0 of '));
  await fileFilter.fill('find-first.md');
  await frame.locator('button.documentation-file[title="find-proof/find-first.md"]').click();
  frame = await findFrame('#rmp-ui-content');
  result = await openFind(frame, 'FIND_VISIBLE_ALPHA');
  checks.push({ mode: 'documentation-home-selected-file', keyboard: 'Ctrl+F', result: result.result });

  const tableSearch = frame.locator('.table-search');
  await tableSearch.fill('TABLE_VISIBLE_ALPHA');
  await frame.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('#rmp-ui-content tbody tr'));
    return rows.some((row) => row.hidden);
  });
  await frame.locator('#rmp-ui-content .diagram-error').waitFor({ state: 'visible', timeout: 10000 });
  await frame.locator('#rmp-ui-content .mermaid-source').waitFor({ state: 'visible', timeout: 5000 });
  await result.widget.locator('input').first().fill('TABLE_HIDDEN_BETA');
  await frame.page().waitForTimeout(150);
  const hiddenRowResult = (await result.widget.locator('.matchesCount').innerText()).trim();
  await result.widget.locator('input').first().fill('DISCLOSURE_HIDDEN_GAMMA');
  await frame.page().waitForTimeout(150);
  const closedDisclosureResult = (await result.widget.locator('.matchesCount').innerText()).trim();
  await result.widget.locator('input').first().fill('DIAGRAM_SOURCE_DELTA');
  await frame.page().waitForTimeout(150);
  const diagramSourceResult = (await result.widget.locator('.matchesCount').innerText()).trim();
  checks.push({
    hiddenFilteredRowFind: hiddenRowResult,
    closedDisclosureFind: closedDisclosureResult,
    diagramSourceFallbackFind: diagramSourceResult,
  });
  await closeFind(result.page);

  // The Documentation Home filename filter and document Find remain separate inputs.
  await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
  frame = await findFrame('input[aria-label="Filter documentation files or folders"]');
  await frame.locator('input[aria-label="Filter documentation files or folders"]').fill('find-second.md');
  await frame.locator('button.documentation-file[title="find-proof/find-second.md"]').click();
  frame = await findFrame('#rmp-ui-content');
  result = await openFind(frame, 'FIND_VISIBLE_OMEGA');
  checks.push({
    mode: 'documentation-navigation-updated-find-results',
    result: result.result,
    filenameFilterLabel: 'Filter documentation files or folders',
  });
  await closeFind(result.page);
};
