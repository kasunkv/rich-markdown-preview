const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {minimatch} = require('minimatch');

function host({ folders = ['/repo', '/other'], settings = {} } = {}) {
  const event = () => {
    const listeners = new Set();
    return { listen: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: value => [...listeners].forEach(fn => fn(value)), listeners };
  };
  const uri = value => ({ scheme:'file', fsPath:value, path: value, with: changes => ({...uri(value),...changes}), toString: () => `file://${value}` });
  const root = value => ({ name: value.split('/').pop(), uri: uri(value) });
  const commands = {}, messages = [], panels = [], warnings = [], opened = [], queries = [], watchers = [], reads = [], selections = [], reveals = [];
  const files = new Map([
    ['/repo/README.md', '# Welcome\n\n[Guide](docs/guide.md#details)\n\n[Code](src/app.ts)'],
    ['/repo/docs/guide.md', '# Guide\n\n## Details\n\n![Image](../assets/test.svg)'],
    ['/repo/reports/2026/october/summary.MD', '# Summary'],
    ['/repo/.claude/skills/test/SKILL.md', '# Skill'],
    ['/repo/node_modules/pkg/README.md', '# Dependency'],
    ['/repo/dist/README.md', '# Build'],
    ['/repo/src/app.ts', 'export const value = 1;'],
    ['/other/README.markdown', '# Other']
  ]);
  const configuration = event(), workspaceFolders = event(), text = event();
  const status = { visible: false, show() {this.visible = true;}, hide() {this.visible = false;}, dispose() {} };
  const getDocument = target => {
    if (!files.has(target.path)) throw new Error('Missing file');
    return { uri: target, fileName: target.path, languageId: 'markdown', getText: () => files.get(target.path) };
  };
  const vscode = {
    Uri: { file: uri, parse: value => uri(value.replace(/^file:\/\//, '')), joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
    Range: class { constructor(startLine, startCharacter, endLine, endCharacter) { this.start = {line: startLine, character: startCharacter}; this.end = {line: endLine, character: endCharacter}; } },
    TextEditorRevealType: {InCenterIfOutsideViewport: 2},
    StatusBarAlignment: {Left: 1}, ViewColumn: {Active: -1, Beside: -2}, FileType: {File: 1, Directory: 2}, ConfigurationTarget: {Global: 1, WorkspaceFolder: 3},
    RelativePattern: class { constructor(base, pattern) { this.baseUri = base.uri ?? base; this.pattern = pattern; } },
    CancellationTokenSource: class { token = {isCancellationRequested: false}; cancel() {this.token.isCancellationRequested = true;} dispose() {} },
    window: {
      createOutputChannel: () => ({appendLine() {},dispose() {}}),
      createStatusBarItem: () => status,
      showInformationMessage: message => warnings.push(message), showWarningMessage: message => warnings.push(message),
      showTextDocument: async (doc, options) => { opened.push(doc.uri.path); selections.push(options?.selection); return {revealRange: (range, type) => reveals.push({range, type})}; },
      createWebviewPanel: (type, title, column, options) => {
        const receive = event(), dispose = event(), view = event();
        const panel = { type, title, column, visible: true, reveals: 0, reveal() {this.reveals++;},
          onDidChangeViewState: view.listen, onDidDispose: dispose.listen,
          dispose() {dispose.fire();},
          webview: { options, cspSource: 'safe:', asWebviewUri: target => target,
            onDidReceiveMessage: fn => {panel.message = fn; return receive.listen(fn);},
            postMessage: async message => { messages.push(message); return true; }
          }
        };
        panels.push(panel); return panel;
      }
    },
    commands: {registerCommand: (name, fn) => {commands[name] = fn; return {dispose() {}};}, executeCommand: async (_, target) => opened.push(target.path)},
    workspace: {
      workspaceFolders: folders.map(root), onDidChangeWorkspaceFolders: workspaceFolders.listen,
      onDidChangeConfiguration: configuration.listen, onDidChangeTextDocument: text.listen,
      getWorkspaceFolder: target => vscode.workspace.workspaceFolders.find(folder => target.path === folder.uri.path || target.path.startsWith(folder.uri.path + '/')),
      getConfiguration: (section, target) => ({get: (key, fallback) => section === 'richMarkdownPreview' ? settings[`${target?.path}:${key}`] ?? settings[key] ?? fallback : fallback, inspect: () => ({})}),
      openTextDocument: async target => {reads.push(target.path); return getDocument(target);},
      fs: { stat: async target => {if (!files.has(target.path)) throw new Error('Missing file'); return {type: 1};} },
      findFiles: async (include, exclude, max, token) => {
        queries.push({include, exclude, token});
        return [...files.keys()].filter(file => file.startsWith(include.baseUri.path + '/') && minimatch(file.slice(include.baseUri.path.length + 1), include.pattern, {dot: true}) && (!exclude || !minimatch(file, exclude, {dot: true}))).map(uri);
      },
      createFileSystemWatcher: pattern => {
        const create = event(), remove = event();
        const watcher = {pattern, onDidCreate: create.listen, onDidDelete: remove.listen, create: create.fire, remove: remove.fire, disposed: false, dispose() {this.disposed = true;} };
        watchers.push(watcher); return watcher;
      }
    }
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/extension.js'), 'utf8'), {module, exports: module.exports, __coverage__: globalThis.__coverage__ ??= {}, Buffer, setTimeout, clearTimeout, console, require: name => name === 'vscode' ? vscode : name === 'node:fs' ? {...fs,realpathSync: value => value,statSync: value => ({isFile: () => value === '/repo/assets/test.svg'})} : require(name)});
  module.exports.activate({subscriptions: [], extensionUri: uri('/extension')});
  const open = async () => {await commands['richMarkdownPreview.openDocumentationHome'](); if (panels.length) await panels.at(-1).message({type: 'ready'});};
  const openSingle = async (file = '/repo/README.md') => { await commands['richMarkdownPreview.openPreview'](uri(file)); await panels.at(-1).message({type: 'ready'}); };
  const action = (action, id) => panels.at(-1).message({type: 'documentationAction', action, id: id && uri(id).toString()});
  const latest = type => messages.filter(message => message.type === type).at(-1);
  return {vscode, settings, status, open, openSingle, selections, reveals, action, latest, files, reads, queries, messages, panels, warnings, opened, watchers, workspaceFolders, configuration, text, uri, getDocument};
}


module.exports = {host};
