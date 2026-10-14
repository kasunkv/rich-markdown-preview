const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Called only by the isolated VS Code host suite, using its loopback CDP connection.
exports.proveNavigation = async ({ vscode, workspace, findFrame, checks }) => {
  const waitUntil = async (predicate, message) => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(predicate(), message);
  };
  const landing = vscode.Uri.file(path.join(workspace, 'docs', 'navigation-landing.md'));
  const target = vscode.Uri.file(path.join(workspace, 'docs', 'navigation-target.md'));
  const lines = ['---', 'label: Example', '---', '', '# Target'];
  for (let i = 0; i < 80; i++) lines.push('', `Paragraph ${i}.`);
  lines.push('', '## Details');
  const first = lines.length - 1;
  lines.push('', '## Details');
  const duplicate = lines.length - 1;
  lines.push('', '## Caf\u00e9 \u65e5\u672c\u8a9e');
  const unicode = lines.length - 1;
  lines.push('', '## ![Architecture](../assets/diagram.svg)');
  const accessible = lines.length - 1;
  await fs.writeFile(target.fsPath, lines.join('\n'));
  await fs.writeFile(
    landing.fsPath,
    '# Landing\n\n[Details](navigation-target.md#details)\n\n[Duplicate](navigation-target.md#details-1)\n\n[Unicode](navigation-target.md?view=source#caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E)\n\n[Accessible](navigation-target.md#architecture)\n\n[Same document](navigation-landing.md#landing)',
  );
  const cases = [
    ['Details', 'details', first],
    ['Duplicate', 'details-1', duplicate],
    ['Unicode', 'caf\u00e9-\u65e5\u672c\u8a9e', unicode],
    ['Accessible', 'architecture', accessible],
  ];
  for (const mode of ['single-file', 'documentation-home']) {
    for (const [label, fragment, line] of cases) {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if (mode === 'single-file') await vscode.commands.executeCommand('richMarkdownPreview.openPreview', landing);
      else {
        await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
        const home = await findFrame('input[aria-label="Filter documentation files or folders"]');
        await home.locator('input[aria-label="Filter documentation files or folders"]').fill('navigation-landing.md');
        await home.locator('button.documentation-file[title="docs/navigation-landing.md"]').click();
      }
      const frame = await findFrame('#rmp-ui-content a');
      await frame.evaluate(() => {
        window.navigationProof = { messages: [], scrolls: [] };
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'render')
            window.navigationProof.messages.push({ id: event.data.documentId, fragment: event.data.fragment });
        });
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (options) {
          window.navigationProof.scrolls.push({ id: this.id, options });
          return original.call(this, options);
        };
      });
      if (label === 'Details') {
        await frame.locator('#rmp-ui-content a').filter({ hasText: 'Same document' }).click();
        await frame.waitForFunction(() =>
          window.navigationProof.messages.some((message) => message.fragment === 'landing'),
        );
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview);
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.label.includes('navigation-landing.md'));
        checks.push({ mode, sameDocumentStayedInPreview: true });
      }
      await frame.locator('#rmp-ui-content a').filter({ hasText: label }).click();
      if (mode === 'single-file') {
        await waitUntil(
          () => vscode.window.activeTextEditor?.document.uri.toString() === target.toString(),
          'Target source opened',
        );
        const editor = vscode.window.activeTextEditor;
        await waitUntil(() => editor.selection.start.line === line, 'Fragment selects its source heading');
        await waitUntil(
          () => editor.visibleRanges.some((range) => range.start.line <= line && range.end.line >= line),
          'Source heading revealed',
        );
        checks.push({ mode, fragment, selectedLine: editor.selection.start.line, revealed: true });
      } else {
        try {
          await frame.waitForFunction(
            (fragment) =>
              document.querySelector(`[data-md-anchor="${fragment}"]`)?.getBoundingClientRect().top <
                window.innerHeight && window.scrollY > 0,
            fragment,
            { timeout: 10000 },
          );
        } catch (error) {
          checks.push({
            mode,
            fragment,
            debug: await frame.evaluate(() => ({
              proof: window.navigationProof,
              ancestors: (() => {
                const result = [];
                let element = document.querySelector('#rmp-ui-content h2');
                while (element) {
                  const style = getComputedStyle(element);
                  result.push({
                    tag: element.tagName,
                    id: element.id,
                    overflow: style.overflowY,
                    display: style.display,
                    client: element.clientHeight,
                    scrollHeight: element.scrollHeight,
                    scroll: element.scrollTop,
                  });
                  element = element.parentElement;
                }
                return result;
              })(),
              title: document.title,
              scrollY: window.scrollY,
              bodyScroll: document.body.scrollTop,
              rootScroll: document.documentElement.scrollTop,
              height: window.innerHeight,
              headings: Array.from(document.querySelectorAll('#rmp-ui-content [data-md-anchor]')).map((heading) => ({
                anchor: heading.getAttribute('data-md-anchor'),
                top: heading.getBoundingClientRect().top,
              })),
              announcement: document.querySelector('#rmp-ui-announcement')?.textContent,
            })),
          });
          throw error;
        }
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputWebview);
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.label.includes('navigation-target.md'));
        assert.equal(await frame.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches), true);
        assert.equal(await frame.evaluate(() => window.navigationProof.scrolls.at(-1)?.options.behavior), 'auto');
        checks.push({ mode, fragment, motion: 'reduce', previewNavigatedAndScrolled: true });
      }
    }
  }
};
