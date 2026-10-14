const vscode=require('vscode');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const manifest=require('../package.json');

exports.run=async()=>{
 const workspace=process.env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE;
 const output=process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT;
 assert.equal(process.env.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST,'1');
 assert.ok(path.resolve(workspace).startsWith(path.resolve(__dirname,'..','.test-results','host')+path.sep));
 const checkpointFile=path.join(path.dirname(output),'reload-checkpoint.json');
 let browser;
 try{
  const extension=vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension);assert.equal(path.resolve(extension.extensionPath),path.resolve(__dirname,'..'));
  await extension.activate();
  browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+process.env.RICH_MARKDOWN_PREVIEW_DEBUG_PORT);
  for(const context of browser.contexts())for(const page of context.pages())await page.emulateMedia({reducedMotion:'reduce'});
  const owns=(tab,type)=>tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(type);
  const reveal=async type=>{
   const deadline=Date.now()+20000;
   while(Date.now()<deadline){
    const group=vscode.window.tabGroups.all.find(group=>group.tabs.some(tab=>owns(tab,type)));
    if(group){
     const index=group.tabs.findIndex(tab=>owns(tab,type));
     if(group.viewColumn>=1&&group.viewColumn<=8)await vscode.commands.executeCommand('workbench.action.focus'+['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth'][group.viewColumn-1]+'EditorGroup');
     await vscode.commands.executeCommand('workbench.action.openEditorAtIndex'+(index+1));
     if(owns(vscode.window.tabGroups.activeTabGroup.activeTab,type))return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   throw Error('Restored native tab could not be selected: '+type);
  };
  const findFrame=async(selector,{viewType}={})=>{
   if(viewType)await reveal(viewType);
   const deadline=Date.now()+20000;
   while(Date.now()<deadline){
    for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames()){
     try{
      if(!await frame.locator(selector).count()||!await frame.locator(selector).first().isVisible())continue;
      let visible=true;
      for(let child=frame;child.parentFrame();child=child.parentFrame())if(!await (await child.frameElement()).isVisible()){visible=false;break;}
      if(!visible)continue;
      if(viewType)assert.ok(owns(vscode.window.tabGroups.activeTabGroup.activeTab,viewType),'Native selected tab owns the visible target');
      return frame;
     }catch(error){if(error instanceof assert.AssertionError)throw error;}
    }
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   const tabs=vscode.window.tabGroups.all.map(group=>({column:group.viewColumn,tabs:group.tabs.map(tab=>({label:tab.label,type:tab.input.viewType,active:tab.isActive}))}));
   const frames=[];for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames())frames.push({url:frame.url(),heading:await frame.locator('#rmp-ui-content h1').allTextContents().catch(()=>[])});
   await fs.writeFile(path.join(path.dirname(output),'reload-frame-diagnostics.json'),JSON.stringify({tabs,frames},null,2));
   throw Error('Selected visible native webview unavailable: '+selector);
  };
  let checkpoint;try{checkpoint=JSON.parse(await fs.readFile(checkpointFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const scenario=require('./reload-realhost.cjs');
  if(!checkpoint){
   checkpoint=await scenario.prepareReload({vscode,workspace,findFrame});
   await fs.writeFile(checkpointFile,JSON.stringify(checkpoint,null,2));
   await browser.close();browser=undefined;
   await vscode.commands.executeCommand('workbench.action.reloadWindow');
   return {reloading:true};
  }
  const checks=await scenario.assertReload({vscode,checkpoint,findFrame});
  await fs.writeFile(output,JSON.stringify({passed:true,hostVersion:vscode.version,preparedPid:checkpoint.preparedPid,restoredPid:process.pid,checks},null,2));
 }catch(error){await fs.writeFile(output,JSON.stringify({passed:false,hostVersion:vscode.version,error:String(error),stack:error.stack},null,2));throw error;}
 finally{await browser?.close();}
};
