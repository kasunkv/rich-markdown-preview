// Browser harness for visual QA; the actual extension uses the VS Code webview API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('../dist/render.cjs');
const root = path.join(__dirname, '..');
async function startPreviewServer({ fixture = 'samples/showcase.md', port = 0 } = {}) {
  const fixturePath = path.resolve(root, fixture);
  const result = renderMarkdown(fs.readFileSync(fixturePath, 'utf8'));
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><title>Rich Markdown Preview — browser QA</title></head><body><div id="rmp-ui-app"></div><script>
let preferences={style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
let state=JSON.parse(sessionStorage.getItem('preview-state')??'null');
function acquireVsCodeApi(){return {getState:()=>state,setState:s=>{state=s;sessionStorage.setItem('preview-state',JSON.stringify(s));},postMessage:async m=>{
if(m.type==='reference'){window.referenceClicks??=[];window.referenceClicks.push(m);}
if(m.type==='ready'){const result=await (await fetch('/document')).json();window.dispatchEvent(new MessageEvent('message',{data:{type:'render',...result,preferences}}));}
if(m.type==='preference'){preferences[m.key]=m.value;window.dispatchEvent(new MessageEvent('message',{data:{type:'preferences',preferences}}));}
if(m.type==='copy'){try{await navigator.clipboard.writeText(m.text);window.dispatchEvent(new MessageEvent('message',{data:{type:'copyResult',success:true}}));}catch{window.dispatchEvent(new MessageEvent('message',{data:{type:'copyResult',success:false}}));}}
if(m.type==='tableCopy'||m.type==='tableExport'){
try {
if(m.type==='tableCopy')await navigator.clipboard.writeText(m.text);
else {const url=URL.createObjectURL(new Blob(['\uFEFF'+m.text],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=m.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
window.dispatchEvent(new MessageEvent('message',{data:{type:'tableActionResult',action:m.type,success:true}}));
}catch(error){window.dispatchEvent(new MessageEvent('message',{data:{type:'tableActionResult',action:m.type,success:false,error:String(error)}}));}
}
}}}
</script><script src="/preview.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page);
    } else if (req.url === '/rich-markdown-preview.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(fs.readFileSync(path.join(root, 'assets/rich-markdown-preview.png')));
    } else if (req.url === '/document') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } else if (req.url === '/preview.js' || req.url === '/preview.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(root, 'dist', req.url.slice(1))));
    } else if (
      req.url === '/assets/preview-test.svg' &&
      fs.existsSync(path.join(path.dirname(fixturePath), 'assets/preview-test.svg'))
    ) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(fs.readFileSync(path.join(path.dirname(fixturePath), 'assets/preview-test.svg')));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
module.exports = { startPreviewServer };
if (require.main === module) {
  startPreviewServer({ fixture: process.argv[2], port: Number(process.env.PORT ?? 0) })
    .then((server) => {
      console.log('Browser QA: ' + server.url);
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
          server.close().catch(console.error);
        });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
