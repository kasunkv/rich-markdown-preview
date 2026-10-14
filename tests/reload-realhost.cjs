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
    const body = `---\ntitle: Reload disclosure\n---\n# Reload ${modes[index]}\n\n| Name | Value |\n| --- | --- |\n| keep | 2 |\n| discard | 1 |\n\n` + Array.from({length:80},(_,i)=>`## Reading ${i}\n\nParagraph ${i} for deterministic scrolling.\n\n`).join('');
    await fs.writeFile(targets[index].fsPath, body);
  }
  await fs.writeFile(path.join(workspace,'reload-documentation-first.md'),'# Reload documentation first\n\nEarlier navigation context.');
  await fs.writeFile(path.join(workspace,'reload-documentation-next.md'),'# Reload documentation next\n\nForward navigation context.');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const expected=[];
  for(let index=0;index<targets.length;index++) {
    const mode=modes[index];
    if(mode==='preview')await vscode.commands.executeCommand('richMarkdownPreview.openPreview',targets[index]);
    else {
      await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
      let home=await findFrame('input[aria-label="Filter documentation files or folders"]');
      await home.locator('input[aria-label="Filter documentation files or folders"]').fill('reload-documentation-first.md');
      await home.locator('button.documentation-file[title="reload-documentation-first.md"]').click();
      home=await findFrame('#rmp-heading-reload-documentation-first');
      await home.locator('input[aria-label="Filter documentation files or folders"]').fill('reload-documentation.md');
      await home.locator('button.documentation-file[title="reload-documentation.md"]').click();
      home=await findFrame('#rmp-heading-reload-documentation');
      await home.locator('input[aria-label="Filter documentation files or folders"]').fill('reload-documentation-next.md');
      await home.locator('button.documentation-file[title="reload-documentation-next.md"]').click();
      home=await findFrame('#rmp-heading-reload-documentation-next');
      await home.getByRole('button',{name:'← Back',exact:true}).click();
    }
    const selector=`#rmp-heading-reload-${mode}`;
    const frame=await findFrame(selector);
    await frame.locator('#rmp-ui-content .frontmatter-raw summary').click();
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
    const tab=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(viewType));
    assert.ok(tab,`${item.mode} panel survived native reload`);
    // The companion supplies findFrame's tab reveal across inactive editor groups.
    const frame=await findFrame(item.selector,{viewType});
    assert.equal(await frame.locator('#rmp-ui-content .frontmatter-raw').getAttribute('open'),'');
    assert.equal(await frame.getByRole('searchbox',{name:'Search table 1',exact:true}).inputValue(),'keep');
    assert.equal(await frame.getByRole('combobox',{name:'Table 1 spacing',exact:true}).inputValue(),'compact');
    assert.equal(await frame.locator('th').first().getAttribute('aria-sort'),'ascending');
    await frame.waitForFunction(expected=>Math.abs(window.scrollY-expected)<100,item.scroll);
    // Panel-level Find survives VS Code's serializer revival; test the native keyboard path.
    await frame.locator('#rmp-ui-content').click();
    await frame.locator('body').press('Control+f');
    const findInput=frame.page().locator('input[aria-label="Find"]').last();
    await findInput.waitFor({state:'visible',timeout:10000});
    await findInput.fill('Reload '+item.mode);
    assert.equal(await findInput.inputValue(),'Reload '+item.mode);
    await findInput.press('Enter');
    await frame.page().locator('.simple-find-part.visible .codicon-find-next-match:not(.disabled)').waitFor({state:'visible',timeout:3000});
    await findInput.press('Escape');
    if(item.mode==='documentation') {
      assert.equal(await frame.getByRole('button',{name:'← Back',exact:true}).isEnabled(),true);
      assert.equal(await frame.getByRole('button',{name:'Forward →',exact:true}).isEnabled(),true);
      await frame.getByRole('button',{name:'← Back',exact:true}).click();
      await findFrame('#rmp-heading-reload-documentation-first',{viewType});
      await frame.getByRole('button',{name:'Forward →',exact:true}).click();
      await findFrame(item.selector,{viewType});
      await frame.getByRole('button',{name:'Forward →',exact:true}).click();
      await findFrame('#rmp-heading-reload-documentation-next',{viewType});
    }
    checks.push({mode:item.mode,uri:item.uri,nativeWindowReload:true,replacedExtensionHost:true,selectedVisiblePanelOwnership:true,nativeFind:true,reading:true,table:true,disclosure:true,backForward:item.mode==='documentation'});
  }
  return checks;
};
