const {test} = require('node:test');
const assert = require('node:assert/strict');
const {previewHost} = require('./preview-host.cjs');
const {host: documentationHost} = require('./documentation-host.cjs');
const origin = 'https://images.example';
const source = `# Privacy\n\n![Private](${origin}/image.svg)`;
const latest = h => h.messages.filter(message => message.type === 'render').at(-1);
async function single(options) {
  const h = previewHost(options); h.document.getText = () => source; await h.handlers.command(); return h;
}

test('native confirmation persists only rendered origins and resets exact CSP/render identity', async () => {
  const h = await single({initial:{allowRemoteImages:true,'externalImageOrigins.v1':[origin]}});
  assert.doesNotMatch(latest(h).html, /src="https:/);
  assert.doesNotMatch(h.panel.webview.html, /img-src[^;]*\shttps:\s/);
  assert.equal(h.panel.webview.html.includes(origin), false);
  await h.handlers.message({type:'grantExternalImageOrigin',origin:'https://forged.example'});
  assert.equal(h.warnings.length,0); assert.equal(h.imageWrites.length,0);
  let confirmation;
  h.vscode.window.showWarningMessage = async (message, options, action) => {confirmation={message,options,action};return action;};
  const before = latest(h).renderId;
  await h.handlers.message({type:'grantExternalImageOrigin',origin});
  assert.equal(confirmation.options.modal,true); assert.match(confirmation.options.detail,/IP address/);
  assert.equal(confirmation.action,'Allow images');
  assert.deepEqual(h.imageState.value,[origin]);
  assert.equal(h.panel.webview.html.includes(origin),true);
  await h.handlers.message({type:'ready'});
  assert.notEqual(latest(h).renderId,before);
  assert.match(latest(h).html,/referrerpolicy="no-referrer"/);
  const count = h.imageWrites.length;
  await h.handlers.rawMessage({type:'revokeExternalImageOrigin',origin,requestId:'old_token',renderId:before});
  assert.equal(h.imageWrites.length,count);
  await h.handlers.message({type:'revokeExternalImageOrigin',origin});
  assert.deepEqual(h.imageState.value,[]);
  assert.equal(h.panel.webview.html.includes(origin),false);
  await h.handlers.message({type:'ready'}); assert.doesNotMatch(latest(h).html,/src="https:/);
});

test('canceled/failed grants stay blocked; failed revoke immediately denies despite old durable grant', async () => {
  const canceled = await single({allowImages:false});
  await canceled.handlers.message({type:'grantExternalImageOrigin',origin});
  assert.equal(canceled.imageWrites.length,0); assert.equal(canceled.panel.webview.html.includes(origin),false);
  const failed = await single({failImageWrites:true});
  await failed.handlers.message({type:'grantExternalImageOrigin',origin});
  assert.match(failed.warnings.at(-1),/Images remain blocked/); assert.equal(failed.panel.webview.html.includes(origin),false);
  assert.ok(failed.diagnostics.every(line => !line.includes('secret')));
  const revoked = await single({imageOrigins:[origin],failImageWrites:true});
  assert.match(latest(revoked).html,/src="https:/);
  await revoked.handlers.message({type:'revokeExternalImageOrigin',origin});
  assert.equal(revoked.panel.webview.html.includes(origin),false);
  assert.deepEqual(revoked.imageState.value,[origin]);
  assert.match(revoked.warnings.at(-1),/blocked for this session/);
  await revoked.handlers.message({type:'ready'}); assert.doesNotMatch(latest(revoked).html,/src="https:/);
  assert.ok(revoked.diagnostics.every(line => !line.includes('secret')));
});

test('document edits/disposal while native prompt is open cannot grant, and disposed panels stop resetting', async () => {
  for (const stale of ['edit','dispose']) {
    const h = await single(); let confirm;
    h.vscode.window.showWarningMessage = () => new Promise(resolve => {confirm=resolve;});
    const pending = h.handlers.message({type:'grantExternalImageOrigin',origin}); await h.drain();
    if (stale==='edit') {h.document.getText = () => '# Changed';h.handlers.text({document:h.document});}
    else h.handlers.dispose();
    const html = h.panel.webview.html;
    confirm('Allow images'); await pending;
    assert.equal(h.imageWrites.length,0); assert.equal(h.panel.webview.html,html);
    if(stale==='edit') await new Promise(resolve => setTimeout(resolve,200));
  }
});

test('pending durable grant completion cannot activate a stale/disposed model', async () => {
  const h = await single(); let finish;
  h.globalState.update = () => new Promise(resolve => {finish=resolve;});
  const pending = h.handlers.message({type:'grantExternalImageOrigin',origin}); await h.drain();
  h.handlers.dispose(); const html=h.panel.webview.html;
  finish(); await pending;
  assert.equal(h.panel.webview.html,html);
});

test('same user-owned policy applies across Home and multiple single-file panels', async () => {
  const h = documentationHost({settings:{allowRemoteImages:true,'externalImageOrigins.v1':[origin]}});
  h.files.set('/repo/README.md',source); h.files.set('/repo/docs/guide.md',source.replace('image.svg','second.svg'));
  await h.open(); await h.action('open','/repo/README.md'); const home=h.panels[0];
  assert.doesNotMatch(latest(h).html,/src="https:/);
  await home.message({type:'grantExternalImageOrigin',origin}); await home.message({type:'ready'});
  assert.match(latest(h).html,/src="https:/);
  await h.openSingle('/repo/docs/guide.md'); const second=h.panels.at(-1);
  assert.match(latest(h).html,/src="https:/);
  await second.message({type:'revokeExternalImageOrigin',origin});
  assert.equal(home.webview.html.includes(origin),false); assert.equal(second.webview.html.includes(origin),false);
  await home.message({type:'ready'}); assert.doesNotMatch(latest(h).html,/src="https:/);
  await second.message({type:'ready'}); assert.doesNotMatch(latest(h).html,/src="https:/);
  home.dispose(); second.dispose();
});

test('unavailable user-state reads fail closed with fixed diagnostics', async () => {
  const h = await single({imageOrigins:{invalid:origin}});
  assert.doesNotMatch(latest(h).html,/src="https:/);
  assert.equal(h.imageWrites.length,0);
});

test('unreadable user grants default block and disposed storage failures stay contained', async () => {
  const unreadable = await single({imageOrigins:[origin],failImageReads:true});
  assert.doesNotMatch(latest(unreadable).html,/src="https:/);
  assert.ok(unreadable.diagnostics.some(line => line.includes('read external image permissions')));
  assert.ok(unreadable.diagnostics.every(line => !line.includes('secret')));
  const h = await single(); let reject;
  h.globalState.update = () => new Promise((_, fail) => {reject=fail;});
  const pending = h.handlers.message({type:'grantExternalImageOrigin',origin}); await h.drain();
  h.handlers.dispose(); const html=h.panel.webview.html; const warnings=h.warnings.length;
  reject(Error('secret write rejected')); await pending; await h.drain();
  assert.equal(h.panel.webview.html,html); assert.equal(h.warnings.length,warnings);
});
