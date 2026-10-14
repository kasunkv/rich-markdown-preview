// Uses the production shell without extra inline scripts or relaxed directives.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { buildWebviewShell } = require('../dist/webview-shell.cjs');
async function startSecurityServer({ imageOrigins = [] } = {}) {
  const requests = [];
  let page;
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page);
    } else if (req.url === '/preview.js' || req.url === '/preview.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(path.join(root, 'dist', req.url.slice(1))));
    } else if (req.url === '/logo.png' || req.url === '/local.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(fs.readFileSync(path.join(root, 'assets', 'rich-markdown-preview.png')));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  page = buildWebviewShell({ nonce: randomBytes(16).toString('hex'), cspSource: url, resourceUris: [url],
    scriptUri: `${url}/preview.js`, styleUri: `${url}/preview.css`, logoUri: `${url}/logo.png`, imageOrigins });
  return { url, requests, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
module.exports = { startSecurityServer };
