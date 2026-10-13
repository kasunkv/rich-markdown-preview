const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.proveAccessibility = async ({vscode, browser, workspace, findFrame, checks}) => {
  const root = path.resolve(__dirname, '..');
  const relative = path.relative(path.join(root,'.test-results','host'),workspace);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Accessibility settings require an isolated host fixture');
  const target = vscode.Uri.file(path.join(workspace,'accessibility-proof.md'));
  await fs.writeFile(target.fsPath,'---\ntitle: Keyboard reading\n---\n# Accessibility proof\n\n[Read section](#reading-section)\n\n```mermaid\nflowchart TD\naccTitle: Reading workflow\naccDescr: The reader can open the source alternative.\nReader-->Source\n```\n\n| Name | Count | Year | Month | State | Category |\n|---|---|---|---|---|---|\n| Alpha | 1 | 2026 | October | Read | Reference |\n| Beta | 2 | 2026 | October | Read | Reference |\n\n## Reading section\n\nAccessible reading content.\n\n```js\nconst reading = "'+'x'.repeat(200)+'";\n```');
  const config = vscode.workspace.getConfiguration(undefined,target);
  const values = Object.fromEntries(['workbench.colorTheme','window.zoomLevel','richMarkdownPreview.openPreviewToSide','richMarkdownPreview.wrapCode'].map(key=>[key,config.inspect(key)?.workspaceValue]));
  const waitFor = async (predicate,label) => {
    const end=Date.now()+20000;
    while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error('Accessibility host condition unavailable: '+label);
  };
  try {
    await config.update('richMarkdownPreview.openPreviewToSide',false,vscode.ConfigurationTarget.Workspace);
    await config.update('window.zoomLevel',0,vscode.ConfigurationTarget.Workspace);
    await config.update('richMarkdownPreview.wrapCode',false,vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('richMarkdownPreview.openPreview',target);
    let frame=await findFrame('#rmp-heading-accessibility-proof');
    await frame.locator('.mermaid-result svg').waitFor();
    let page=frame.page();
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
        const reset=frame.locator('.table-reset').first();
        if(await reset.isEnabled()){await reset.focus();await page.keyboard.press('Enter');}
        await frame.locator('.table-sort').first().focus(); await page.keyboard.press('Enter');
        assert.match(await frame.locator('th').first().getAttribute('aria-sort'),/ascending|descending/);
        await frame.locator('.frontmatter > summary').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
        const localCode=await frame.locator('.code-block pre').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
        assert.ok(localCode.scrollWidth>localCode.width && localCode.overflow==='auto','Long code retains intentional local scrolling');
        const button=frame.locator('#rmp-ui-toggle-outline');
        await button.focus();
        const focus=await button.evaluate(el=>{const rect=el.getBoundingClientRect(),css=getComputedStyle(el);return {active:document.activeElement===el,top:rect.top,bottom:rect.bottom,height:innerHeight,outlineStyle:css.outlineStyle,outlineWidth:css.outlineWidth};});
        assert.ok(focus.active && focus.bottom>0 && focus.top<focus.height && focus.outlineStyle==='solid','Keyboard control has visible focus in actual viewport');
        const localTable=await frame.locator('.table-scroll').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
        assert.ok(localTable.scrollWidth>localTable.width && localTable.overflow==='auto','Wide table retains intentional local scrolling');
        observations.push({theme,scale,geometry,localCode,localTable,focus,baselineWorkbench:base});
        await page.screenshot({path:path.join(workspace,`accessibility-${kind}-${scale}.png`)});
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('richMarkdownPreview.openDocumentationHome');
        let home=await findFrame('input[aria-label="Filter documentation"]');
        let homePage=home.page();
        await home.getByRole('searchbox',{name:'Filter documentation'}).fill('accessibility-proof.md');
        await home.locator('button.documentation-file[title="accessibility-proof.md"]').focus(); await homePage.keyboard.press('Enter');
        home=await findFrame('#rmp-heading-accessibility-proof');homePage=home.page();
        await home.getByRole('button',{name:'On this page',exact:true}).focus(); await homePage.keyboard.press('Enter');
        await home.locator('#rmp-ui-outline a').first().focus(); await homePage.keyboard.press('Enter');
        assert.equal(await home.evaluate(()=>document.activeElement.id),'rmp-heading-accessibility-proof');
        const homeGeometry=await home.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dpr:devicePixelRatio}));
        assert.ok(homeGeometry.scrollWidth<=homeGeometry.width+1,'Native Documentation Home reflow');
        observations.at(-1).documentationKeyboard={treeSelection:true,outlineHeadingFocus:true,geometry:homeGeometry};
        if(scale===4 && kind===vscode.ColorThemeKind.HighContrastLight && process.env.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST==='1') {
          await require('./privacy-realhost.cjs').proveExternalImages({vscode,browser,workspace,findFrame,checks});
          observations.at(-1).nativePrivacyKeyboard=true;
        }
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('richMarkdownPreview.openPreview',target);
        frame=await findFrame('#rmp-heading-accessibility-proof');page=frame.page();
        await frame.locator('.mermaid-result svg').waitFor();
      }
    }
    checks.push({nativeAccessibility:observations,screenReader:'Not observed: manual assistive technology validation remains pending'});
  } finally {
    for(const [key,value] of Object.entries(values))await config.update(key,value,vscode.ConfigurationTarget.Workspace);
  }
};
