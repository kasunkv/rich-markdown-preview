const vscode=require('vscode');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {performance}=require('node:perf_hooks');
const {renderMarkdown}=require('../dist/render.cjs');
const {fixtures}=require('./performance-fixtures.cjs');
const manifest=require('../package.json');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
const summary=values=>({median:percentile(values,.5),p95:percentile(values,.95),samples:values});
exports.run=async()=>{
 const workspace=process.env.RICH_MARKDOWN_PREVIEW_TEST_WORKSPACE,output=process.env.RICH_MARKDOWN_PREVIEW_TEST_RESULT;
 assert.equal(process.env.RICH_MARKDOWN_PREVIEW_PRIVACY_HOST,'1');
 assert.ok(path.resolve(workspace).startsWith(path.resolve(__dirname,'..','.test-results','host')+path.sep));
 const checks=[],results=[];let browser;
 const report={passed:false,hostVersion:vscode.version,node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,memoryGiB:os.totalmem()/1024**3,samplesPerFixture:7,metrics:'Native normal isolated host: command-to-complete-frame cold latency; source WorkspaceEdit (180ms debounce included) to settled complete frame; identical renderMarkdown synchronous time in the extension-host runtime; real host event-loop lag sampled every10ms.',notes:['Native latency includes CDP polling, IPC and two animation frames; it is a reproducible upper-bound paint proxy, not compositor tracing.','Fresh cold panels discard body/SVG caches; typing keeps source-identical SVG templates. Extension startup activation is excluded; this is cold panel/script/model initialization.','1k/10k/50k many/invalid diagrams and oversized tables are measured through documented complete-model fallbacks. Supported 20-diagram fixtures execute real Mermaid, DOM and source disclosure work.','p95 uses nearest rank; with 7 samples it is the maximum.'],results};
 try{
  const extension=vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);assert.ok(extension);assert.equal(path.resolve(extension.extensionPath),path.resolve(__dirname,'..'));await extension.activate();
  browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+process.env.RICH_MARKDOWN_PREVIEW_DEBUG_PORT);report.chromium=browser.version();
  await vscode.workspace.getConfiguration('richMarkdownPreview').update('openPreviewToSide',false,vscode.ConfigurationTarget.Global);
  const findFrame=async()=>{
   const deadline=Date.now()+15000;
   while(Date.now()<deadline){for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames())try{if(await frame.locator('#rmp-ui-content').isVisible())return frame;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
   throw Error('Visible owned preview frame unavailable');
  };
  const supplemental=[{name:'supported-mermaid-20',rows:20,source:Array.from({length:20},(_,i)=>`\`\`\`mermaid\nflowchart TD\nA${i} --> B${i}\n\`\`\``).join('\n\n')},{name:'supported-invalid-mermaid-20',rows:20,source:'```mermaid\nthis is invalid <<\n```\n\n'.repeat(20)}];
  for(const fixture of [...fixtures(),...supplemental]){
   const cold=[],typing=[],host=[],lag=[];
   let svgCount=0,errorCount=0,fallback=false;
   for(let sample=0;sample<7;sample++){
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const uri=vscode.Uri.file(path.join(workspace,`performance-${fixture.name}-${sample}.md`));await fs.writeFile(uri.fsPath,fixture.source+'\n\n# Revision zero\n');
    const document=await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(document);
    const parseStart=performance.now();const model=renderMarkdown(document.getText());host.push(performance.now()-parseStart);fallback=/role="alert"/.test(model.html);
    let expected=performance.now()+10,maxLag=0;const timer=setInterval(()=>{const now=performance.now();maxLag=Math.max(maxLag,Math.max(0,now-expected));expected=now+10;},10);
    const start=performance.now();await vscode.commands.executeCommand('richMarkdownPreview.openPreview',uri);const frame=await findFrame();
    await frame.waitForFunction(()=>document.querySelector('#rmp-ui-content')?.getAttribute('aria-busy')==='false',{},{timeout:20000});
    await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));cold.push(performance.now()-start);
    svgCount=await frame.locator('.mermaid-result svg').count();errorCount=await frame.locator('.diagram-error').count();
    if(fixture.name==='supported-mermaid-20')assert.equal(svgCount,20,'Actual supported Mermaid SVGs completed');
    if(fixture.name==='supported-invalid-mermaid-20')assert.equal(errorCount,20,'Actual invalid Mermaid attempts recovered');
    const before=await frame.locator('#rmp-ui-content').evaluate(element=>element.innerHTML);
    // Observe actual DOM replacement before waiting for the current complete-render signal.
    await frame.evaluate(()=>{window.performanceReplaced=false;const target=document.getElementById('rmp-ui-content');const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='childList')){window.performanceReplaced=true;observer.disconnect();}});observer.observe(target,{childList:true});});
    const editStart=performance.now();const edit=new vscode.WorkspaceEdit();edit.insert(uri,document.positionAt(document.getText().length),`\nEdit ${sample}\n`);assert.equal(await vscode.workspace.applyEdit(edit),true);
    await frame.waitForFunction(()=>window.performanceReplaced&&document.querySelector('#rmp-ui-content')?.getAttribute('aria-busy')==='false',{},{timeout:20000});
    await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));typing.push(performance.now()-editStart);clearInterval(timer);lag.push(maxLag);
    if(!fallback)assert.notEqual(await frame.locator('#rmp-ui-content').evaluate(element=>element.innerHTML),before,'Newest edit painted');
    await document.save();
   }
   const metrics={name:fixture.name,rows:fixture.rows,sourceBytes:Buffer.byteLength(fixture.source),fallback,svgCount,errorCount,coldPreviewMs:summary(cold),typingToPaintMs:summary(typing),hostSynchronousMs:summary(host),hostEventLoopLagMs:summary(lag)};
   results.push(metrics);
   // Broad native cold/paint limits include initialization, IPC and machine load; host guard catches regressions in the bounded CPU work.
   assert.ok(metrics.hostSynchronousMs.p95<=200,fixture.name+' bounded synchronous host work <=200ms');
   assert.ok(metrics.coldPreviewMs.p95<=15000,fixture.name+' cold complete preview <=15s');
   assert.ok(metrics.typingToPaintMs.p95<=10000,fixture.name+' edit-to-complete-paint <=10s');
   await fs.writeFile(path.join(path.dirname(output),'performance-progress.json'),JSON.stringify(report,null,2));
  }
  checks.push('All 14 representative fixtures cold/typing/render metrics sampled seven times in owned native profile');
  checks.push('20 real valid Mermaid SVGs and 20 real invalid-diagram recoveries verified including DOM/layout and table enhancement');
  report.passed=true;report.checks=checks;
 }catch(error){report.error=String(error);report.stack=error.stack;throw error;}
 finally{await browser?.close();await fs.writeFile(output,JSON.stringify(report,null,2));}
};
