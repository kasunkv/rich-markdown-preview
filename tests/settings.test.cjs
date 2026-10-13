const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const manifest = require('../package.json');

function previewHost({ inWorkspace = true, failWrites = false, cancelExport = false, failExport = false, failCopy = false, noEditor = false, languageId = 'markdown', fileName = '/fixture/test.md', failOpen = false, missingReference = false, initial = {}, previous = {}, legacy = {} } = {}) {
  const saved = {...initial};
  const messages = [];
  const warnings = [];
  const errors = [];
  const writes = [];
  const clipboard = [], files = [], dialogs = [], opened = [], external = [], info = [];
  let created = 0, revealed = 0, disposed = 0;
  const columns = [];
  const handlers = {};
  const disposable = {dispose() {disposed++;}};
  const uri = {path: fileName, toString: () => `file://${fileName}`};
  const document = {uri, fileName, languageId, getText: () => '# Test'};
  const configuration = {
    inspect: key => ({globalValue: saved[key]}),
    get: (key, fallback) => saved[key] ?? fallback,
    update: async (key, value, target) => {
      writes.push({key, value, target});
      if (target === 3 && manifest.contributes.configuration.properties[`richMarkdownPreview.${key}`].scope !== 'resource') throw new Error('Setting does not support folder scope');
      if (failWrites) throw new Error('Settings file is read-only');
      saved[key] = value;
      handlers.configuration?.({affectsConfiguration: () => true});
    }
  };
  const panel = {
    visible: true, reveal(column) {revealed++; columns.push(column);},
    onDidChangeViewState: handler => {handlers.view = handler; return disposable;},
    onDidDispose: handler => {handlers.dispose = handler; return disposable;},
    webview: {
      cspSource: 'https://safe-resource', asWebviewUri: () => 'safe-resource',
      postMessage: message => { messages.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: handler => { handlers.message = handler; return disposable; }
    }
  };
  const vscode = {
    StatusBarAlignment: {Left: 1},
    Uri: {joinPath: (base, ...segments) => ({toString: () => `${base.toString()}/${segments.join('/')}`}), parse: value => ({toString: () => value})}, FileType: {File:1, Directory:2}, ViewColumn: {Beside: -2, Active: -1}, ConfigurationTarget: {Global: 1, WorkspaceFolder: 3},
    window: {createStatusBarItem: () => ({show() {}, hide() {}, dispose() {}}), activeTextEditor: noEditor ? undefined : {document}, createWebviewPanel: (type, title, column) => {created++; columns.push(column); return panel;}, showInformationMessage: message => info.push(message), showWarningMessage: message => warnings.push(message), showSaveDialog: async options => { dialogs.push(options); return cancelExport ? undefined : uri; }},
    env: {openExternal: async uri => external.push(uri.toString()), clipboard: {writeText: async text => {if(failCopy) throw new Error('Clipboard unavailable'); clipboard.push(text);}}},
    workspace: {
      onDidChangeWorkspaceFolders: () => disposable,
      fs: {stat:async () => {if(missingReference) throw new Error('Missing'); return {type:1};}, writeFile: async (destination, bytes) => { if (failExport) throw new Error('Disk is read-only'); files.push({destination, text:Buffer.from(bytes).toString('utf8')}); }},
      openTextDocument: async () => {if(failOpen) throw new Error('File unavailable');return document;},
      getConfiguration: section => section === 'richMarkdownPreview' ? configuration : {get:(key, fallback) => (section === 'markdownLens' ? previous : legacy)[key] ?? fallback},
      getWorkspaceFolder: () => inWorkspace ? {uri} : undefined,
      onDidChangeTextDocument: handler => {handlers.text = handler;return disposable;},
      onDidChangeConfiguration: handler => {handlers.configuration = handler; return disposable;}
    },
    commands: {executeCommand: async (command, uri) => opened.push({command,uri:uri.toString()}), registerCommand: (id, handler) => {handlers[id] = handler; if (id === 'richMarkdownPreview.openPreview') handlers.command = handler; return disposable;}}
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/extension.js'), 'utf8'), {
    module, exports: module.exports, __coverage__: globalThis.__coverage__ ??= {}, Buffer, setTimeout, clearTimeout, console: {...console, error: (...args) => errors.push(args)},
    require: name => name === 'vscode' ? vscode : require(name)
  });
  module.exports.activate({subscriptions: [], extensionUri: uri});
  const drain = async () => {await new Promise(setImmediate);};
  return {columns, handlers, saved, messages, warnings, errors, writes, clipboard, files, dialogs, drain, document, panel, opened, external, info, counts: () => ({created, revealed, disposed})};
}

test('rejected webview notifications are observed without an unhandled rejection', async () => {
  const host = previewHost();
  await host.handlers.command();
  host.panel.webview.postMessage = () => Promise.reject(new Error('Disposed webview fixture'));
  await host.handlers.message({type: 'ready'});
  await host.drain();
  assert.ok(host.errors.some(args => args[0].includes('asynchronous operation failed') && args[1].message === 'Disposed webview fixture'));
});

test('async message callback catches unexpected errors when VS Code ignores its result', async () => {
  const host = previewHost();
  await host.handlers.command();
  host.document.getText = () => {throw new Error('Closed document fixture');};
  await host.handlers.message({type: 'ready'});
  assert.equal(host.errors.length, 1);
  assert.match(host.errors[0][0], /message failed/);
  assert.equal(host.errors[0][1].message, 'Closed document fixture');
});

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

test('reference clicks use only rendered targets and resolve root, relative and dialect paths', async () => {
  const host = previewHost();
  host.document.getText = () => '{{include: /snippets/guide.md}}\n\n@references/guide.md\n\n{% include notice.md %}\n\n--8<-- "guide.md:2:4"';
  await host.handlers.command(); await host.handlers.message({type:'ready'});
  const references = host.messages.at(-1).references;
  for (const reference of references) await host.handlers.message({type:'reference',id:reference.id});
  assert.deepEqual(host.opened.map(item => item.uri).sort(), ['file:///fixture/test.md/snippets/guide.md','file:///fixture/test.md/../references/guide.md','file:///fixture/test.md/_includes/notice.md','file:///fixture/test.md/../guide.md'].sort());
  host.saved.referenceRoot = 'skills/my-skill';
  await host.handlers.message({type:'reference', id:references.find(ref => ref.path.startsWith('/snippets')).id});
  assert.equal(host.opened.at(-1).uri, 'file:///fixture/test.md/skills/my-skill/snippets/guide.md');
  const count = host.opened.length;
  await host.handlers.message({type:'reference', id:'forged', path:'command:bad'});
  assert.equal(host.opened.length, count);
});

test('missing references produce a warning and remote references open only on click', async () => {
  const host = previewHost({missingReference:true});
  host.document.getText = () => '{{include: missing.md}}\n\n{{include: https://example.com/snippet.md}}';
  await host.handlers.command(); await host.handlers.message({type:'ready'});
  assert.equal(host.external.length, 0);
  await host.handlers.message({type:'reference',id:'reference-0'});
  assert.match(host.warnings.at(-1), /Could not open referenced file/);
  await host.handlers.message({type:'reference',id:'reference-1'});
  assert.deepEqual(host.external, ['https://example.com/snippet.md']);
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

test('legacy settings remain a fallback, new settings take precedence, and writes use the new namespace', async () => {
  const legacy = {style:'reading',appearance:'dark',contentWidth:720,fontSize:18,lineHeight:1.9,wrapCode:true};
  const host=previewHost({legacy,initial:{style:'ocean',wrapCode:false}});
  await host.handlers.command(); await host.handlers.message({type:'ready'});
  const prefs=host.messages.at(-1).preferences;
  assert.equal(prefs.style,'ocean'); assert.equal(prefs.wrapCode,false);
  assert.equal(prefs.appearance,'dark'); assert.equal(prefs.contentWidth,720);
  await host.handlers.message({type:'preference',key:'appearance',value:'light'}); await host.drain();
  assert.equal(host.saved.appearance,'light'); assert.equal(legacy.appearance,'dark');
  host.handlers.configuration({affectsConfiguration:section=>section==='styledMarkdown'});
  assert.equal(host.messages.at(-1).preferences.appearance,'light');
});

test('the legacy command alias reuses the branded preview handler', async () => {
  const host=previewHost();
  await host.handlers['styledMarkdown.openPreview'](); await host.handlers['richMarkdownPreview.openPreview']();
  assert.equal(host.counts().created,1); assert.equal(host.counts().revealed,1);
});

test('Markdown Lens settings precede styledMarkdown fallbacks and Rich Markdown Preview settings override both', async () => {
  const host=previewHost({initial:{appearance:'light',wrapCode:false},previous:{style:'ocean',appearance:'dark'},legacy:{style:'reading',fontSize:18,wrapCode:true}});
  await host.handlers.command(); await host.handlers.message({type:'ready'});
  const prefs=host.messages.at(-1).preferences;
  assert.equal(prefs.style,'ocean'); assert.equal(prefs.appearance,'light');
  assert.equal(prefs.fontSize,18); assert.equal(prefs.wrapCode,false);
  host.handlers.configuration({affectsConfiguration:section=>section==='markdownLens'});
  assert.equal(host.messages.at(-1).type,'preferences');
  await host.handlers['markdownLens.openPreview'](); assert.equal(host.counts().revealed,1);
});
test('all eighteen styles are accepted and persisted through the preview message handler', async () => {
  const host = previewHost();
  await host.handlers.command();
  const styles = manifest.contributes.configuration.properties['richMarkdownPreview.style'].enum;
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

test('invalid and malformed preference messages cannot write settings', async () => {
  const host = previewHost(); await host.handlers.command();
  for (const message of [null, 1, {}, {type:'preference',key:'__proto__',value:'x'},
    {type:'preference',key:'style',value:'missing'}, {type:'preference',key:'appearance',value:[]},
    ...[NaN, Infinity, 479, 1601, '900'].map(value => ({type:'preference',key:'contentWidth',value})),
    {type:'preference',key:'fontSize',value:25}, {type:'preference',key:'lineHeight',value:1.2},
    {type:'preference',key:'wrapCode',value:'true'}]) await host.handlers.message(message);
  await host.drain(); assert.equal(host.writes.length, 0);
});

test('invalid settings read from disk fall back safely; valid range boundaries persist', async () => {
  const host = previewHost({initial:{style:'missing',appearance:42,contentWidth:NaN,fontSize:100,lineHeight:-1,wrapCode:'true'}});
  await host.handlers.command(); await host.handlers.message({type:'ready'});
  const prefs = host.messages.at(-1).preferences;
  assert.equal(prefs.style,'documentation'); assert.equal(prefs.appearance,'auto');
  assert.equal(prefs.contentWidth,900); assert.equal(prefs.fontSize,16); assert.equal(prefs.lineHeight,1.7); assert.equal(prefs.wrapCode,false);
  for (const [key,values] of Object.entries({contentWidth:[480,1600],fontSize:[12,24],lineHeight:[1.3,2.2]})) {
    for (const value of values) {await host.handlers.message({type:'preference',key,value});await host.drain();assert.equal(host.saved[key],value);}
  }
});

test('rapid preference commits serialize writes and preserve the newest value', async () => {
  const host = previewHost(); await host.handlers.command();
  await Promise.all(['reading','ocean','circuit'].map(value=>host.handlers.message({type:'preference',key:'style',value})));
  await host.drain(); assert.deepEqual(host.writes.map(write=>write.value),['reading','ocean','circuit']);
  assert.equal(host.messages.at(-1).preferences.style,'circuit');
  const before = host.messages.length;
  host.handlers.configuration({affectsConfiguration:()=>false}); assert.equal(host.messages.length,before);
  host.handlers.configuration({affectsConfiguration:()=>true}); assert.equal(host.messages.at(-1).type,'preferences');
});

test('command handles missing editors, non-Markdown files and failed file opens', async () => {
  for (const options of [{noEditor:true}, {languageId:'plaintext',fileName:'/fixture/test.txt'}]) {
    const host = previewHost(options); await host.handlers.command();
    assert.equal(host.counts().created, 0); assert.match(host.info[0], /Markdown file/);
  }
  const host = previewHost({failOpen:true}); await host.handlers.command(host.document.uri);
  assert.equal(host.counts().created, 0); assert.match(host.warnings[0], /Could not open/);
});

test('md files open with any language through editor and Explorer commands', async () => {
  for (const languageId of ['plaintext', 'yaml', 'python']) {
    for (const fileName of ['/fixture/SKILL.md', '/fixture/ARTICLE.MD']) {
      const host = previewHost({languageId, fileName});
      await host.handlers.command();
      await host.handlers.command(host.document.uri);
      assert.equal(host.counts().created, 1);
      assert.equal(host.counts().revealed, 1);
      assert.equal(host.info.length, 0);
    }
  }
  const host = previewHost({fileName:'/fixture/notes.txt'});
  await host.handlers.command();
  assert.equal(host.counts().created, 1, 'Markdown language remains supported without an md extension');
});

test('placement setting controls creation and reuse and applies on next invocation', async () => {
  for (const [setting, column] of [[undefined, -2], [true, -2], [false, -1], ['invalid', -2]]) {
    const host = previewHost({initial:{openPreviewToSide:setting}});
    await host.handlers.command(); await host.handlers.command();
    assert.deepEqual(host.columns, [column, column]);
    host.saved.openPreviewToSide = false;
    await host.handlers.command(host.document.uri);
    assert.equal(host.columns.at(-1), -1);
    assert.equal(host.counts().created, 1);
  }
});

test('Explorer selection arguments do not change a single-file preview into Documentation Home', async () => {
  const host = previewHost();
  await host.handlers.command(host.document.uri, [host.document.uri]);
  await host.handlers.message({type: 'ready'});
  assert.equal(host.counts().created, 1);
  assert.equal(host.messages.at(-1).documentationHome, undefined);
  assert.match(host.messages.at(-1).html, /Test/);
});

test('panels are reused, disposed listeners are released, and reopening creates a panel', async () => {
  const host = previewHost(); await host.handlers.command(host.document.uri);
  await host.handlers.command(); assert.deepEqual(host.counts(), {created:1,revealed:1,disposed:0});
  host.handlers.dispose(); assert.equal(host.counts().disposed, 4);
  await host.handlers.command(); assert.equal(host.counts().created, 2);
});

test('ready and visible-panel events render; edits debounce and unrelated edits are ignored', async () => {
  const host = previewHost(); await host.handlers.command();
  await host.handlers.message({type:'ready'}); assert.match(host.messages.at(-1).html, /<h1/);
  host.panel.visible = false; host.handlers.view(); assert.equal(host.messages.length, 1);
  host.panel.visible = true; host.handlers.view(); assert.equal(host.messages.length, 2);
  host.handlers.text({document:{uri:{toString:()=> 'file:///other.md'}}});
  await new Promise(resolve => setTimeout(resolve, 210)); assert.equal(host.messages.length, 2);
  host.handlers.text({document:host.document}); host.handlers.text({document:host.document});
  await new Promise(resolve => setTimeout(resolve, 210)); assert.equal(host.messages.length, 3);
  host.handlers.text({document:host.document}); host.handlers.dispose();
  await new Promise(resolve => setTimeout(resolve, 210)); assert.equal(host.messages.length, 3);
});

test('webview has a restrictive CSP, local roots, branded title and icon', async () => {
  const host = previewHost(); await host.handlers.command();
  assert.match(host.panel.webview.html, /default-src 'none'/);
  assert.match(host.panel.webview.html, /script-src 'nonce-[a-f0-9]{32}'/);
  assert.doesNotMatch(host.panel.webview.html, /script-src[^;]*unsafe-inline/);
  assert.match(host.panel.webview.html, /<title>Rich Markdown Preview<\/title>/);
  assert.match(host.panel.iconPath.toString(), /assets\/rich-markdown-preview.png$/);
});

test('links allow external web/mail and local files while blocking executable schemes', async () => {
  const host = previewHost(); await host.handlers.command();
  for (const href of ['https://example.com', 'http://example.com', 'mailto:test@example.com',
    'javascript:alert(1)', 'command:workbench.action.closeWindow', 'file:///etc/passwd', '//example.com']) {
    await host.handlers.message({type:'link',href});
  }
  assert.equal(host.external.length, 3); assert.equal(host.opened.length, 0);
  await host.handlers.message({type:'link',href:'linked%20note.md#heading'});
  assert.equal(host.opened[0].command, 'vscode.open'); assert.match(host.opened[0].uri, /linked note.md$/);
  await host.handlers.message({type:'link',href:'%broken'}); assert.equal(host.warnings.length, 1);
});

test('code clipboard results reflect success and failure; invalid export filenames are replaced', async () => {
  for (const failCopy of [false, true]) {
    const host = previewHost({failCopy}); await host.handlers.command();
    await host.handlers.message({type:'copy',text:'const x = 1;'});
    assert.equal(host.messages.at(-1).type, 'copyResult'); assert.equal(host.messages.at(-1).success, !failCopy);
    await host.handlers.message({type:'tableCopy',text:'data'});
    assert.equal(host.messages.at(-1).success, !failCopy);
  }
  const host = previewHost(); await host.handlers.command();
  await host.handlers.message({type:'tableExport',text:'data',filename:'../../escape.csv'});
  assert.match(host.dialogs[0].defaultUri.toString(), /\/table.csv$/);
});
