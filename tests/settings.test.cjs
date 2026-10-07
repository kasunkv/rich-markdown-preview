const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const manifest = require('../package.json');

function previewHost({ inWorkspace = true, failWrites = false, cancelExport = false, failExport = false } = {}) {
  const saved = {};
  const messages = [];
  const warnings = [];
  const writes = [];
  const clipboard = [], files = [], dialogs = [];
  const handlers = {};
  const disposable = {dispose() {}};
  const uri = {toString: () => 'file:///fixture/test.md'};
  const document = {uri, fileName: '/fixture/test.md', languageId: 'markdown', getText: () => '# Test'};
  const configuration = {
    get: (key, fallback) => saved[key] ?? fallback,
    update: async (key, value, target) => {
      writes.push({key, value, target});
      if (target === 3 && manifest.contributes.configuration.properties[`styledMarkdown.${key}`].scope !== 'resource') throw new Error('Setting does not support folder scope');
      if (failWrites) throw new Error('Settings file is read-only');
      saved[key] = value;
      handlers.configuration?.({affectsConfiguration: () => true});
    }
  };
  const panel = {
    visible: true, reveal() {},
    onDidChangeViewState: () => disposable,
    onDidDispose: () => disposable,
    webview: {
      asWebviewUri: () => 'safe-resource',
      postMessage: message => { messages.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: handler => { handlers.message = handler; return disposable; }
    }
  };
  const vscode = {
    Uri: {joinPath: () => uri}, ViewColumn: {Beside: 2}, ConfigurationTarget: {Global: 1, WorkspaceFolder: 3},
    window: {activeTextEditor: {document}, createWebviewPanel: () => panel, showWarningMessage: message => warnings.push(message), showSaveDialog: async options => { dialogs.push(options); return cancelExport ? undefined : uri; }},
    env: {clipboard: {writeText: async text => clipboard.push(text)}},
    workspace: {
      fs: {writeFile: async (destination, bytes) => { if (failExport) throw new Error('Disk is read-only'); files.push({destination, text:Buffer.from(bytes).toString('utf8')}); }},
      getConfiguration: () => configuration,
      getWorkspaceFolder: () => inWorkspace ? {uri} : undefined,
      onDidChangeTextDocument: () => disposable,
      onDidChangeConfiguration: handler => {handlers.configuration = handler; return disposable;}
    },
    commands: {registerCommand: (id, handler) => {handlers.command = handler; return disposable;}}
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/extension.js'), 'utf8'), {
    module, exports: module.exports, Buffer, setTimeout, clearTimeout, console,
    require: name => name === 'vscode' ? vscode : require(name)
  });
  module.exports.activate({subscriptions: [], extensionUri: uri});
  const drain = async () => {await new Promise(setImmediate);};
  return {handlers, saved, messages, warnings, writes, clipboard, files, dialogs, drain};
}

test('preview toolbar settings persist with resource scope', async () => {
  const host = previewHost();
  await host.handlers.command();
  for (const [key, value] of Object.entries({style:'reading',appearance:'dark',contentWidth:720,fontSize:18,lineHeight:1.9,wrapCode:true})) {
    await host.handlers.message({type:'preference',key,value}); await host.drain();
    assert.equal(host.saved[key], value);
    assert.equal(host.messages.at(-1).preferences[key], value);
  }
  assert.equal(host.warnings.length, 0);
  assert.ok(host.writes.every(write => write.target === 3));
});
test('failed saves retain live preferences through subsequent refreshes', async () => {
  const host = previewHost({failWrites:true});
  await host.handlers.command();
  await host.handlers.message({type:'preference',key:'style',value:'reading'}); await host.drain();
  await host.handlers.message({type:'preference',key:'appearance',value:'dark'}); await host.drain();
  await host.handlers.message({type:'ready'});
  assert.equal(host.messages.at(-1).type, 'render');
  assert.equal(host.messages.at(-1).preferences.style, 'reading');
  assert.equal(host.messages.at(-1).preferences.appearance, 'dark');
  assert.match(host.warnings[0], /Settings file is read-only/);
  assert.ok(host.messages.every(message => message.type !== 'preferenceError'));
});
test('standalone Markdown files save preferences globally', async () => {
  const host = previewHost({inWorkspace:false});
  await host.handlers.command();
  await host.handlers.message({type:'preference',key:'contentWidth',value:680}); await host.drain();
  assert.equal(host.saved.contentWidth, 680);
  assert.equal(host.writes[0].target, 1);
});
test('all eighteen styles are accepted and persisted through the preview message handler', async () => {
  const host = previewHost();
  await host.handlers.command();
  const styles = manifest.contributes.configuration.properties['styledMarkdown.style'].enum;
  assert.equal(styles.length, 18);
  for (const style of styles) {
    await host.handlers.message({type:'preference',key:'style',value:style}); await host.drain();
    assert.equal(host.saved.style, style);
    assert.equal(host.messages.at(-1).preferences.style, style);
  }
  assert.equal(host.warnings.length, 0);
});

test('table copy and CSV export use the clipboard and chosen file destination', async () => {
  const host = previewHost(); await host.handlers.command();
  const text = '"Name","Value"\r\n"Alpha","1"\r\n';
  await host.handlers.message({type:'tableCopy',text});
  assert.deepEqual(host.clipboard, [text]);
  assert.equal(host.messages.at(-1).success, true);
  await host.handlers.message({type:'tableExport',text,filename:'table-1.csv'});
  assert.equal(host.dialogs[0].saveLabel, 'Export CSV');
  assert.equal(host.files[0].text, '\uFEFF'+text);
  assert.equal(host.messages.at(-1).action, 'tableExport');
  assert.equal(host.messages.at(-1).success, true);
});

test('cancelled and failed table exports report accurately and do not silently succeed', async () => {
  const cancelled = previewHost({cancelExport:true}); await cancelled.handlers.command();
  await cancelled.handlers.message({type:'tableExport',text:'"Test"\r\n'});
  assert.equal(cancelled.files.length, 0); assert.equal(cancelled.messages.at(-1).cancelled, true);
  const failed = previewHost({failExport:true}); await failed.handlers.command();
  await failed.handlers.message({type:'tableExport',text:'"Test"\r\n'});
  assert.equal(failed.messages.at(-1).success, false);
  assert.match(failed.messages.at(-1).error, /Disk is read-only/);
  assert.equal(failed.warnings.length, 1);
});
