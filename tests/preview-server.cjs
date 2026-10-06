// Browser harness for visual QA; the actual extension uses the VS Code webview API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('../dist/render.cjs');
const root = path.join(__dirname, '..');
const fixturePath = path.resolve(root, process.argv[2] ?? 'samples/showcase.md');
const result = renderMarkdown(fs.readFileSync(fixturePath, 'utf8'));
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><title>Styled Markdown Preview — browser QA</title></head><body><div id="app"></div><script>
let preferences={style:'documentation',appearance:'light',contentWidth:900,fontSize:16,lineHeight:1.7,wrapCode:false};
let state;
function acquireVsCodeApi(){return {getState:()=>state,setState:s=>state=s,postMessage:async m=>{
if(m.type==='ready'){const result=await (await fetch('/document')).json();window.dispatchEvent(new MessageEvent('message',{data:{type:'render',...result,preferences}}));}
if(m.type==='preference'){preferences[m.key]=m.value;window.dispatchEvent(new MessageEvent('message',{data:{type:'preferences',preferences}}));}
if(m.type==='copy')await navigator.clipboard.writeText(m.text);
}}}
</script><script src="/preview.js"></script></body></html>`;
http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(page); }
  else if (req.url === '/document') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result)); }
  else if (req.url === '/preview.js' || req.url === '/preview.css') { res.setHeader('Content-Type',req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(root,'dist',req.url.slice(1)))); }
  else if (req.url === '/assets/preview-test.svg' && fs.existsSync(path.join(path.dirname(fixturePath), 'assets/preview-test.svg'))) { res.setHeader('Content-Type','image/svg+xml'); res.end(fs.readFileSync(path.join(path.dirname(fixturePath), 'assets/preview-test.svg'))); }
  else { res.writeHead(404); res.end(); }
}).listen(4173, '127.0.0.1', () => console.log('Browser QA: http://127.0.0.1:4173'));
