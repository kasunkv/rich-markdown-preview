const vscode=require('vscode');const fs=require('node:fs/promises');const path=require('node:path');
exports.run=async()=>{
 const output=process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT,checks=[];
 const browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+process.env.RICH_MARKDOWN_PREVIEW_DEBUG_PORT);
 try{
  await vscode.extensions.getExtension('kasunkodagoda.rich-markdown-preview').activate();
  const findFrame=async selector=>{const deadline=Date.now()+20000;while(Date.now()<deadline){for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames()){try{if(await frame.locator(selector).count())return frame;}catch{}}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Provider webview unavailable: '+selector);};
  if(process.env.RICH_MARKDOWN_PREVIEW_TEST_TRUST==='restricted')await require('./provider-host.cjs').proveRestrictedProviders({vscode,findFrame,checks});else await require('./provider-host.cjs').proveProviders({vscode,findFrame,checks});
  await fs.writeFile(output,JSON.stringify({passed:true,hostVersion:vscode.version,checks},null,2));
 }catch(error){await fs.writeFile(output,JSON.stringify({passed:false,hostVersion:vscode.version,checks,error:String(error),stack:error.stack},null,2));throw error;}finally{await browser.close();}
};
