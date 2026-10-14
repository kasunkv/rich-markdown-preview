const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previewHost } = require('./preview-host.cjs');
const { host } = require('./documentation-host.cjs');
test('a queued resource callback after panel disposal cannot render or read', async () => {
  const callbacks = [];
  const h = previewHost({
    initializeVscode(vscode) {
      vscode.workspace.createFileSystemWatcher = () => ({
        dispose() {},
        onDidChange(fn) {
          callbacks.push(fn);
          return { dispose() {} };
        },
        onDidCreate(fn) {
          callbacks.push(fn);
          return { dispose() {} };
        },
        onDidDelete(fn) {
          callbacks.push(fn);
          return { dispose() {} };
        },
      });
    },
  });
  await h.handlers.command();
  await h.drain();
  h.panel.dispose();
  const count = h.messages.length;
  h.document.getText = () => {
    throw Error('disposed document must not be read');
  };
  callbacks.forEach((fn) => fn());
  await h.drain();
  assert.equal(h.messages.length, count);
  assert.deepEqual(h.errors, []);
});
test('history authorization completing after disposal cannot open a saved document', async () => {
  const h = host();
  await h.open();
  await h.action('open', '/repo/README.md');
  await h.action('open', '/repo/docs/guide.md');
  let finish;
  h.vscode.workspace.fs.stat = () =>
    new Promise((resolve) => {
      finish = () => resolve({ type: 1 });
    });
  const pending = h.action('back');
  await new Promise(setImmediate);
  h.panels[0].dispose();
  const reads = h.reads.length,
    messages = h.messages.length;
  finish();
  await pending;
  await new Promise(setImmediate);
  assert.equal(h.reads.length, reads);
  assert.equal(h.messages.length, messages);
});

test('workspace removal between history authorization and navigation prevents a document read', async () => {
  const h = host();
  await h.open();
  await h.action('open', '/repo/README.md');
  await h.action('open', '/repo/docs/guide.md');
  const reads = h.reads.length;
  let checks = 0;
  h.vscode.workspace.fs.isWritableFileSystem = () => {
    if (++checks === 2)
      queueMicrotask(() => {
        h.vscode.workspace.workspaceFolders = [];
      });
    return true;
  };
  await h.action('back');
  await new Promise(setImmediate);
  assert.equal(h.reads.length, reads);
  assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md');
});

test('Back to Home uses no saved-target read and Forward reauthorizes the file', async () => {
  const h = host();
  await h.open();
  await h.action('open', '/repo/README.md');
  const reads = h.reads.length;
  await h.action('back');
  assert.equal(h.latest('render').documentId, 'home');
  assert.equal(h.reads.length, reads);
  await h.action('forward');
  assert.equal(h.latest('render').documentId, 'file:///repo/README.md');
  assert.equal(h.reads.length, reads + 1);
});
test('oversized host source posts a readable bounded model without retaining its body', async () => {
  const h = previewHost();
  h.document.getText = () => 'x'.repeat(2_000_001);
  await h.handlers.command();
  await h.drain();
  const result = h.messages.filter((message) => message.type === 'render').at(-1);
  assert.match(result.html, /2,000,000/);
  assert.ok(result.html.length < 1000);
  assert.deepEqual(result.outline, []);
  h.handlers.view();
  await h.drain();
  assert.equal(h.messages.filter((message) => message.type === 'render').length, 1);
});
