const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise VS Code's own webview Find widget through the real workbench keyboard path.
exports.proveFind = async ({ vscode, findFrame, workspace, checks }) => {
  assert.equal(process.platform, 'win32', 'This smoke covers Windows Ctrl+F only');
  const directory = path.join(workspace, 'find-proof');
  await fs.mkdir(directory, { recursive: true });
  const first = path.join(directory, 'find-first.md');
  const second = path.join(directory, 'find-second.md');
  await fs.writeFile(
    first,
    '# Find proof\n\nFIND_VISIBLE_ALPHA\n\n| State | Value |\n| --- | --- |\n| shown | TABLE_VISIBLE_ALPHA |\n| omitted | TABLE_HIDDEN_BETA |\n\n' + ('Navigation spacer content.\n\n'.repeat(40)) + 'FIND_VISIBLE_ALPHA\n\n```mermaid\ngraph TD\n A[DIAGRAM_SOURCE_DELTA] -->\n```\n',
  );
  await fs.writeFile(second, '# Second Find proof\n\nFIND_VISIBLE_OMEGA\n');

  const findActiveFrame = findFrame;

  const openFind = async (frame, phrase, expectedTabLabel) => {
    assert.ok(
      vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview,
      'Ctrl+F is tested while the preview webview is the active editor',
    );
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, expectedTabLabel);
    let activeFrame = frame;
    let page = activeFrame.page();
    try {
      await activeFrame.locator('#rmp-ui-content').click();
    } catch {
      activeFrame = await findActiveFrame('#rmp-ui-content');
      page = activeFrame.page();
      await activeFrame.locator('#rmp-ui-content').click();
    }
    try {
      await activeFrame.locator('body').press('Control+f');
    } catch {
      activeFrame = await findActiveFrame('#rmp-ui-content');
      page = activeFrame.page();
      await activeFrame.locator('#rmp-ui-content').click();
      await activeFrame.locator('body').press('Control+f');
    }
    // Stable 1.141 includes a separate hidden Chat Find input before the webview widget.
    const input = page.locator('input[aria-label="Find"]').last();
    try {
      await input.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      const frames = await Promise.all(
        page.frames().map((candidate) =>
          candidate
            .evaluate(() => ({
              url: location.href,
              title: document.title,
              active: document.activeElement?.outerHTML?.slice(0, 500),
              inputs: Array.from(document.querySelectorAll('input')).map((input) => ({
                html: input.outerHTML.slice(0, 300),
                ancestors: (() => {
                  const result = [];
                  let node = input;
                  for (let index = 0; node && index < 7; index++, node = node.parentElement)
                    result.push({ tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 120) });
                  return result;
                })(),
              })),
              visibleFind: Array.from(document.querySelectorAll('.find-widget, [class*="find-widget"]')).map((node) => ({
                className: node.className,
                text: node.textContent?.slice(0, 80),
                display: getComputedStyle(node).display,
                visibility: getComputedStyle(node).visibility,
              })),
            }))
            .catch((error) => ({ error: String(error) })),
        ),
      );
      throw new Error(`Ctrl+F did not show the native webview Find widget: ${JSON.stringify(frames)}`);
    }
    assert.equal(await input.evaluate((element) => document.activeElement === element), true, 'Native Find input is focused');
    await input.press('Control+a');
    await input.type(phrase, { delay: 25 });
    await page.waitForTimeout(250);
    assert.equal(await input.inputValue(), phrase, 'Native Find widget accepted the search text');
    const widget = page.locator('.simple-find-part.visible');
    assert.ok(await widget.isVisible(), 'VS Code simple Find widget is visible');
    const widgetState = async () => widget.evaluate((node) => ({
      className: node.className,
      text: node.textContent?.trim(),
      controls: Array.from(node.querySelectorAll('button, [role="button"], [aria-label], [title]')).map((item) => ({
        tag: item.tagName,
        className: item.className,
        label: item.getAttribute('aria-label'),
        title: item.getAttribute('title'),
        disabled: item.disabled,
        disabledClass: item.classList.contains('disabled'),
      })),
    }));
    await input.press('Enter');
    // VS Code debounces its native findInFrame request by 200ms.
    await page.locator('.simple-find-part.visible .codicon-find-next-match:not(.disabled)').waitFor({ state: 'visible', timeout: 3000 });

    const matchState = await widgetState();
    await input.press('Control+a');
    await input.type('RMP_DELIBERATE_NO_MATCH_842019', { delay: 25 });
    await page.locator('.simple-find-part.visible .codicon-find-next-match.disabled').waitFor({ state: 'visible', timeout: 3000 });
    const noMatchState = await widgetState();
    const nextButton = (state) => state.controls.find((control) => control.label === 'Next Match');
    assert.equal(nextButton(matchState)?.disabledClass, false, 'Native Find reports at least one match');
    assert.equal(nextButton(noMatchState)?.disabledClass, true, 'Native Find disables navigation for a missing term');
    await input.press('Control+a');
    await input.type(phrase, { delay: 25 });
    await input.press('Enter');
    await page.locator('.simple-find-part.visible .codicon-find-next-match:not(.disabled)').waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(workspace, 'find-native-match.png') });
    const query = async (term) => {
      await input.press('Control+a');
      await input.type(term, { delay: 25 });
      await input.press('Enter');
      await page.waitForTimeout(500);
      return { term, ...(await widgetState()) };
    };
    return { page, input, query, result: { exactQuery: phrase, matchState, noMatchState, count: 'not exposed by the native webview Find widget' } };
  };
  const closeFind = async (page) => page.keyboard.press('Escape');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openPreview', vscode.Uri.file(first));
  let frame = await findActiveFrame('#rmp-ui-content');
  let result = await openFind(frame, 'FIND_VISIBLE_ALPHA', 'Rich Markdown Preview: find-first.md');
  await result.page.screenshot({ path: path.join(workspace, 'find-native-first-match.png') });
  const nextMatch = result.page.locator('.simple-find-part.visible .codicon-find-next-match:not(.disabled)');
  await nextMatch.click();
  await result.page.waitForTimeout(500);
  await result.page.screenshot({ path: path.join(workspace, 'find-native-next-match.png') });
  assert.ok(await nextMatch.isVisible(), 'Native next-match control remains enabled after navigation');
  result.result.navigation = 'Native Next Match activated; before/after screenshots saved for observed viewport movement';
  checks.push({ mode: 'single-file', keyboard: 'Ctrl+F', result: result.result });
  await closeFind(result.page);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
  frame = await findActiveFrame('input[aria-label="Filter documentation files or folders"]');
  const fileFilter = frame.locator('input[aria-label="Filter documentation files or folders"]');
  await fileFilter.fill('FIND_VISIBLE_ALPHA');
  await frame.waitForFunction(() => document.querySelector('.documentation-notice')?.textContent?.startsWith('0 of '));
  await fileFilter.fill('find-first.md');
  await frame.locator('button.documentation-file[title="find-proof/find-first.md"]').click();
  frame = await findActiveFrame('#rmp-ui-content');
  result = await openFind(frame, 'FIND_VISIBLE_ALPHA', 'Documentation: find-first.md');
  checks.push({ mode: 'documentation-home-selected-file', keyboard: 'Ctrl+F', result: result.result });

  frame = await findActiveFrame('#rmp-ui-content');
  const tableSearch = frame.locator('.table-search');
  await tableSearch.fill('TABLE_VISIBLE_ALPHA');
  await frame.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('#rmp-ui-content tbody tr'));
    return rows.some((row) => row.hidden);
  });
  await frame.locator('#rmp-ui-content .diagram-error').waitFor({ state: 'visible', timeout: 10000 });
  await frame.locator('#rmp-ui-content .mermaid-source').waitFor({ state: 'visible', timeout: 5000 });
  const hiddenRowResult = await result.query('TABLE_HIDDEN_BETA');
  const diagramSourceResult = await result.query('DIAGRAM_SOURCE_DELTA');
  checks.push({
    hiddenFilteredRowFind: hiddenRowResult,
    diagramSourceFallbackFind: diagramSourceResult,
  });
  await closeFind(result.page);

  // The Documentation Home filename filter and document Find remain separate inputs.
  await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
  frame = await findActiveFrame('input[aria-label="Filter documentation files or folders"]');
  await frame.locator('input[aria-label="Filter documentation files or folders"]').fill('find-second.md');
  await frame.locator('button.documentation-file[title="find-proof/find-second.md"]').click();
  frame = await findActiveFrame('#rmp-ui-content');
  result = await openFind(frame, 'FIND_VISIBLE_OMEGA', 'Documentation: find-second.md');
  checks.push({
    mode: 'documentation-navigation-updated-find-results',
    result: result.result,
    filenameFilterLabel: 'Filter documentation files or folders',
  });
  await closeFind(result.page);
};
