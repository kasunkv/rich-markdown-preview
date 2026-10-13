const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.proveAccessibility = async ({vscode, browser, workspace, findFrame, checks}) => {
  const root = path.resolve(__dirname, '..');
  const relative = path.relative(path.join(root,'.test-results','host'),workspace);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Accessibility settings require an isolated host fixture');
  const target = vscode.Uri.file(path.join(workspace,'accessibility-proof.md'));
  await fs.writeFile(target.fsPath,'---\ntitle: Keyboard reading\n---\n# Accessibility proof\n\n[Read section](#reading-section)\n\n```mermaid\nflowchart TD\naccTitle: Reading workflow\naccDescr: The reader can open the source alternative.\nReader-->Source\n```\n\n| Name | Count |\n|---|---|\n| Alpha | 1 |\n| Beta | 2 |\n\n## Reading section\n\nAccessible reading content.');
  const config = vscode.workspace.getConfiguration(undefined,target);
  const values = Object.fromEntries(['workbench.colorTheme','window.zoomLevel','richMarkdownPreview.openPreviewToSide'].map(key=>[key,config.inspect(key)?.workspaceValue]));
  const waitFor = async (predicate,label) => {
    const end=Date.now()+20000;
    while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error('Accessibility host condition unavailable: '+label);
  };
  try {
    await config.update('richMarkdownPreview.openPreviewToSide',false,vscode.ConfigurationTarget.Workspace);
    await config.update('window.zoomLevel',0,vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview',target);
    let frame=await findFrame('#rmp-heading-accessibility-proof');
    await frame.locator('.mermaid-result svg').waitFor();
    const page=frame.page();
    const base=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
    const observations=[];
    for(const [theme,kind,bodyClass] of [['Default High Contrast',vscode.ColorThemeKind.HighContrast,'vscode-high-contrast'],['Default High Contrast Light',vscode.ColorThemeKind.HighContrastLight,'vscode-high-contrast-light']]) {
      await config.update('workbench.colorTheme',theme,vscode.ConfigurationTarget.Workspace);
      await waitFor(()=>vscode.window.activeColorTheme.kind===kind,'native '+theme);
      await frame.waitForFunction(bodyClass=>document.body.classList.contains(bodyClass),bodyClass);
      for(const scale of [2,4]) {
        await config.update('window.zoomLevel',Math.log(scale)/Math.log(1.2),vscode.ConfigurationTarget.Workspace);
        await waitFor(async()=>Math.abs((await page.evaluate(()=>devicePixelRatio))/base.dpr-scale)<.2,'native '+scale*100+'% zoom');
        frame=await findFrame('#rmp-heading-accessibility-proof');
        const geometry=await frame.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dpr:devicePixelRatio,background:getComputedStyle(document.body).backgroundColor,foreground:getComputedStyle(document.body).color,cssZoom:getComputedStyle(document.body).zoom,language:document.documentElement.lang}));
        assert.equal(geometry.cssZoom,'1','Native window zoom must not use a CSS zoom proxy');
        assert.ok(geometry.scrollWidth<=geometry.width+1,`${theme} native ${scale*100}% reflow`);
        assert.equal(geometry.language,'en');
        await frame.locator('.diagram-source summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await frame.locator('.diagram-source').getAttribute('open'),'');
        await page.keyboard.press('Tab');
        assert.equal(await frame.evaluate(()=>document.activeElement.className),'mermaid-source');
        await frame.locator('.diagram-source summary').focus(); await page.keyboard.press('Enter');
        await frame.locator('.table-sort').first().focus(); await page.keyboard.press('Enter');
        assert.match(await frame.locator('th').first().getAttribute('aria-sort'),/ascending|descending/);
        await frame.locator('.frontmatter > summary').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
        observations.push({theme,scale,geometry,baselineWorkbench:base});
        await page.screenshot({path:path.join(workspace,`accessibility-${kind}-${scale}.png`)});
      }
    }
    checks.push({nativeAccessibility:observations,screenReader:'Not observed: manual assistive technology validation remains pending'});
  } finally {
    for(const [key,value] of Object.entries(values))await config.update(key,value,vscode.ConfigurationTarget.Workspace);
  }
};
