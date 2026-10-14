const vm = require('node:vm');
const fs = require('node:fs');
const manifest = require('../package.json');

function previewHost({ inWorkspace = true, workspaceTrusted = true, initializeVscode, failWrites = false, cancelExport = false, failExport = false, failCopy = false, noEditor = false, languageId = 'markdown', fileName = '/fixture/test.md', failOpen = false, missingReference = false, initial = {}, previous = {}, legacy = {}, imageOrigins = [], allowImages = true, failImageWrites = false, failImageReads = false } = {}) {
  const imageState = {value:imageOrigins,failWrites:failImageWrites,failRead:failImageReads};
  const imageWrites = [];
  const globalState = {
    get() {if(imageState.failRead) throw Error('secret user state read'); return imageState.value;},
    async update(key, value) {imageWrites.push({key,value}); if(imageState.failWrites) throw Error('secret user state write'); imageState.value=Array.from(value);},
  };
  let wireMessage;
  const saved = {...initial};
  const messages = [];
  const warnings = [];
  const errors = [];
  const diagnostics = [];
  const writes = [];
  const clipboard = [], files = [], dialogs = [], opened = [], external = [], info = [];
  let created = 0, revealed = 0, disposed = 0;
  const columns = [];
  const handlers = {};
  const trustListeners = new Set();
  let trustRegistrations = 0;
  let requestSequence = 0;
  const disposable = {dispose() {disposed++;}};
  const uri = {scheme: 'file', authority: '', path: fileName, toString: () => `file://${fileName}`};
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
    dispose() {handlers.dispose?.();},
    visible: true, reveal(column) {revealed++; columns.push(column);},
    onDidChangeViewState: handler => {handlers.view = handler; return disposable;},
    onDidDispose: handler => {handlers.dispose = handler; return disposable;},
    webview: {
      cspSource: 'https://safe-resource', options: {}, asWebviewUri: () => 'https://safe-resource',
      postMessage: message => { messages.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: nativeHandler => {
        const handler = message => nativeHandler(wireMessage(message));
        handlers.rawMessage = handler;
        handlers.message = async message => {
          if (!message || typeof message !== 'object' || Array.isArray(message) || Object.getPrototypeOf(message) !== Object.prototype || !Object.values(Object.getOwnPropertyDescriptors(message)).every(descriptor => 'value' in descriptor)) return handler(message);
          if (message.type === 'ready') return handler(message);
          if (!messages.some(value => value.type === 'render')) await handler({type:'ready'});
          const render = messages.filter(value => value.type === 'render').at(-1);
          const complete = {requestId:'fixture_' + ++requestSequence,renderId:render?.renderId,...message};
          if ((message.type === 'tableCopy' || message.type === 'tableExport') && !Object.hasOwn(message,'filename')) complete.filename='table-1.csv';
          return handler(complete);
        };
        return disposable;
      }
    }
  };
  const resourceEvents=[];
  const vscode = {
    RelativePattern: class { constructor(base,pattern) {this.base=base;this.pattern=pattern;} },
    StatusBarAlignment: {Left: 1},
    Uri: {joinPath: (base, ...segments) => ({scheme: base.scheme ?? 'file', authority: base.authority ?? '', toString: () => `${base.toString()}/${segments.join('/')}`}), parse: value => ({toString: () => value})}, FileType: {File:1, Directory:2}, ViewColumn: {Beside: -2, Active: -1}, ConfigurationTarget: {Global: 1, WorkspaceFolder: 3},
    window: {createOutputChannel: () => ({appendLine:line => diagnostics.push(line),dispose(){}}), createStatusBarItem: () => ({show() {}, hide() {}, dispose() {}}), activeTextEditor: noEditor ? undefined : {document}, createWebviewPanel: (type, title, column, options) => {panel.webview.options=options;created++; columns.push(column); return panel;}, showInformationMessage: message => info.push(message), showWarningMessage: (message, _options, ...items) => {warnings.push(message); return Promise.resolve(items.includes('Allow images') && allowImages ? 'Allow images' : undefined);}, showSaveDialog: async options => { dialogs.push(options); return cancelExport ? undefined : uri; }},
    env: {openExternal: async uri => external.push(uri.toString()), clipboard: {writeText: async text => {if(failCopy) throw new Error('Clipboard unavailable'); clipboard.push(text);}}},
    workspace: {
      isTrusted: workspaceTrusted,
      createFileSystemWatcher: () => {
        const listeners=[];const watcher={onDidChange: fn=>{listeners.push(fn);return disposable;},onDidCreate:fn=>{listeners.push(fn);return disposable;},onDidDelete:fn=>{listeners.push(fn);return disposable;},dispose(){listeners.length=0;}};
        resourceEvents.push(()=>listeners.forEach(fn=>fn()));return watcher;
      },
      onDidGrantWorkspaceTrust: handler => {trustRegistrations++;trustListeners.add(handler);return {dispose:()=>trustListeners.delete(handler)};},
      onDidChangeWorkspaceFolders: handler => {handlers.folders=handler;return disposable;},
      fs: {stat:async () => {if(missingReference) throw new Error('Missing'); return {type:1};}, writeFile: async (destination, bytes) => { if (failExport) throw new Error('Disk is read-only'); files.push({destination, text:Buffer.from(bytes).toString('utf8')}); }},
      openTextDocument: async () => {if(failOpen) throw new Error('File unavailable');return document;},
      getConfiguration: section => section === 'richMarkdownPreview' ? configuration : {get:(key, fallback) => (section === 'markdownLens' ? previous : legacy)[key] ?? fallback},
      getWorkspaceFolder: () => inWorkspace ? {uri} : undefined,
      onDidChangeTextDocument: handler => {handlers.text = handler;return disposable;},
      onDidChangeConfiguration: handler => {handlers.configuration = handler; return disposable;}
    },
    commands: {executeCommand: async (command, uri) => opened.push({command,uri:uri.toString()}), registerCommand: (id, handler) => {handlers[id] = handler; if (id === 'richMarkdownPreview.openPreview') handlers.command = async (...args) => {await handler(...args); if (handlers.rawMessage && !messages.some(message => message.type === 'render')) await handlers.rawMessage({type:'ready'});}; return disposable;}}
  };
  initializeVscode?.(vscode);
  const module = {exports: {}};
  const runtime = vm.createContext({
    module, exports: module.exports, __coverage__: globalThis.__coverage__ ??= {}, Buffer, URL, setTimeout, clearTimeout, console: {...console, error: (...args) => errors.push(args)},
    require: name => name === 'vscode' ? vscode : require(name)
  });
  wireMessage = require('./vm-wire.cjs').wireParser(runtime);
  vm.runInContext(fs.readFileSync(require.resolve('../dist/extension.js'), 'utf8'), runtime);
  const subscriptions=[];
  module.exports.activate({subscriptions, extensionUri: uri, globalState});
  const drain = async () => {await new Promise(setImmediate);};
  return {resourceEvents,trustListeners,trustRegistrations:()=>trustRegistrations,fireTrust:()=>[...trustListeners].forEach(listener=>listener()),globalState, imageState, imageWrites, subscriptions, vscode, configuration, diagnostics, columns, handlers, saved, messages, warnings, errors, writes, clipboard, files, dialogs, drain, document, panel, opened, external, info, counts: () => ({created, revealed, disposed})};
}


module.exports = {previewHost};
