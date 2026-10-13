const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Two lifecycle phases: the normal isolated-host companion must restart this harness after
// workbench.action.reloadWindow. Calling assertReload in the original extension host is forbidden.
exports.prepareReload = async ({vscode, workspace, findFrame}) => {
  assert.equal(process.env.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST, '1', 'Use the isolated normal-host companion');
  assert.equal(path.resolve(workspace), path.resolve(process.env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE), 'Use the runner fixture workspace');
  assert.ok(path.resolve(workspace).startsWith(path.resolve(__dirname, '..', '.test-results', 'host') + path.sep), 'Never operate on a real workspace');
  const modes = ['preview', 'documentation'];
  const targets = modes.map(mode => vscode.Uri.file(path.join(workspace, `reload-${mode}.md`)));
  for (let index = 0; index < targets.length; index++) {
    const body = `# Reload ${modes[index]}\n\n<details><summary>Reload disclosure</summary>Disclosure survives reload.</details>\n\n| Name | Value |\n| --- | --- |\n| keep | 2 |\n| discard | 1 |\n\n` + Array.from({length:80},(_,i)=>`## Reading ${i}\n\nParagraph ${i} for deterministic scrolling.\n\n`).join('');
    await fs.writeFile(targets[index].fsPath, body);
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const expected=[];
  for(let index=0;index<targets.length;index++) {
    const mode=modes[index];
    if(mode==='preview')await vscode.commands.executeCommand('richMarkdownPreview.openPreview',targets[index]);
    else {
      await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
      const home=await findFrame('input[aria-label="Filter documentation"]');
      await home.locator('input[aria-label="Filter documentation"]').fill('reload-documentation.md');
      await home.locator('button.documentation-file[title="reload-documentation.md"]').click();
    }
    const selector=`#rmp-heading-reload-${mode}`;
    const frame=await findFrame(selector);
    await frame.locator('#rmp-ui-content summary').click();
    await frame.getByRole('searchbox',{name:'Search table 1',exact:true}).fill('keep');
    await frame.getByRole('combobox',{name:'Table 1 spacing',exact:true}).selectOption('compact');
    await frame.locator('.table-sort').first().click();
    await frame.evaluate(()=>window.scrollTo(0,1200));
    await frame.waitForFunction(()=>window.scrollY>500);
    // The bounded codec will flush on hide/reload; give its current debounce time to settle.
    await new Promise(resolve=>setTimeout(resolve,600));
    expected.push({mode,selector,uri:targets[index].toString(),scroll:await frame.evaluate(()=>window.scrollY)});
  }
  return {version:1,preparedPid:process.pid,hostVersion:vscode.version,expected};
};

exports.assertReload = async ({vscode, checkpoint, findFrame}) => {
  assert.equal(checkpoint.version,1);
  assert.notEqual(process.pid,checkpoint.preparedPid,'Reload must replace the extension host process');
  assert.equal(vscode.version,checkpoint.hostVersion);
  const checks=[];
  for(const item of checkpoint.expected) {
    // Reveal restored tabs, without invoking either preview-opening command.
    const viewType=item.mode==='preview'?'richMarkdownPreview.preview':'richMarkdownPreview.documentationHome';
    const tab=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.input instanceof vscode.TabInputWebview && tab.input.viewType===viewType);
    assert.ok(tab,`${item.mode} panel survived native reload`);
    // The companion supplies findFrame's tab reveal across inactive editor groups.
    const frame=await findFrame(item.selector,{viewType});
    assert.equal(await frame.locator('#rmp-ui-content details').first().getAttribute('open'),'');
    assert.equal(await frame.getByRole('searchbox',{name:'Search table 1',exact:true}).inputValue(),'keep');
    assert.equal(await frame.getByRole('combobox',{name:'Table 1 spacing',exact:true}).inputValue(),'compact');
    assert.equal(await frame.locator('.table-sort').first().getAttribute('aria-sort'),null);
    assert.equal(await frame.locator('th').first().getAttribute('aria-sort'),'ascending');
    await frame.waitForFunction(expected=>Math.abs(window.scrollY-expected)<100,item.scroll);
    checks.push({mode:item.mode,uri:item.uri,nativeWindowReload:true,replacedExtensionHost:true,reading:true,table:true,disclosure:true});
  }
  return checks;
};
