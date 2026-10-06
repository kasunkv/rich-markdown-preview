const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const manifest = require('../package.json');

function previewHost({ inWorkspace = true, failWrites = false } = {}) {
  const saved = {};
  const messages = [];
  const warnings = [];
  const writes = [];
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
    window: {activeTextEditor: {document}, createWebviewPanel: () => panel, showWarningMessage: message => warnings.push(message)},
    workspace: {
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
  return {handlers, saved, messages, warnings, writes, drain};
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
