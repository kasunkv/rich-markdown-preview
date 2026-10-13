const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { minimatch } = require('minimatch');

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

test('home entry points appear without opening Markdown, and a workspace is required', async () => {
  const h = host(); assert.equal(h.status.visible, true); assert.equal(h.status.command, 'richMarkdownPreview.openDocumentationHome');
  h.settings['documentation.showStatusBar'] = false; h.configuration.fire({affectsConfiguration: () => true}); assert.equal(h.status.visible, false);
  await h.open(); await h.open(); assert.equal(h.panels.length, 1); assert.equal(h.panels[0].reveals, 1); assert.equal(h.panels[0].column, -1);
  const empty = host({folders: []}); assert.equal(empty.status.visible, false); await empty.open(); assert.equal(empty.panels.length, 0); assert.match(empty.warnings[0], /Open a folder/);
});

test('discovery includes hidden and nested docs across roots, skips dependencies, and reads no content', async () => {
  const h = host(); await h.open();
  const files = h.latest('documentation').files;
  assert.equal(files.length, 5); assert.ok(files.some(file => file.path === '.claude/skills/test/SKILL.md'));
  assert.ok(files.some(file => file.path === 'reports/2026/october/summary.MD'));
  assert.ok(files.some(file => file.rootName === 'other'));
  assert.equal(h.reads.length, 0); assert.ok(h.queries.every(query => query.exclude.includes('node_modules')));
});

test('selection, relative Markdown links with anchors, images, source, history and non-Markdown links', async () => {
  const h = host(); await h.open(); await h.action('open', '/repo/README.md');
  const ref = h.latest('render').references[0];
  await h.panels[0].message({type: 'reference', id: ref.id});
  assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md'); assert.equal(h.latest('render').fragment, 'details');
  assert.match(h.latest('render').html, /file:\/\/\/repo\/assets\/test.svg/);
  assert.equal(h.panels[0].webview.options.localResourceRoots[2].path, '/repo');
  await h.action('source'); assert.equal(h.opened.at(-1), '/repo/docs/guide.md');
  await h.action('back'); assert.equal(h.latest('render').documentId, 'file:///repo/README.md');
  const code = h.latest('render').references[1]; await h.panels[0].message({type: 'reference', id: code.id}); assert.equal(h.opened.at(-1), '/repo/src/app.ts');
  await h.action('forward'); assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md');
  await h.action('home'); assert.equal(h.latest('render').documentId, 'home');
  await h.action('back'); assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md');
  assert.equal(h.panels.length, 1);
});

test('forged tree targets and stale home references do not open files', async () => {
  const h = host(); await h.open(); await h.action('open', '/outside/secret.md'); assert.equal(h.reads.length, 0);
  await h.action('open', '/repo/README.md'); await h.action('home');
  await h.panels[0].message({type: 'reference', id: 'reference-0'}); assert.equal(h.reads.length, 1);
});

test('home renders always carry navigation data and excluded linked documents survive refresh', async () => {
  const h = host(); await h.open(); await h.action('home');
  assert.equal(h.messages.at(-1).type, 'documentation'); assert.equal(h.messages.at(-1).files.length, 5);
  h.files.set('/repo/README.md', '[Dependency](node_modules/pkg/README.md)');
  await h.action('open', '/repo/README.md');
  await h.panels[0].message({type: 'reference', id: h.latest('render').references[0].id});
  await h.action('refresh');
  assert.equal(h.latest('render').documentId, 'file:///repo/node_modules/pkg/README.md');
  h.settings['documentation.exclude'] = ''; await h.action('refresh');
  assert.ok(h.latest('documentation').files.some(file => file.path === 'node_modules/pkg/README.md'));
  assert.equal(h.queries.at(-1).exclude, null);
});

test('refresh handles additions, deletion of active docs, excludes, empty results and failures', async () => {
  const h = host(); await h.open(); await h.action('open', '/repo/README.md');
  h.files.set('/repo/docs/new.md', '# New'); h.files.delete('/repo/README.md'); await h.action('refresh');
  assert.equal(h.latest('render').documentId, 'home'); assert.ok(h.latest('documentation').files.some(file => file.path === 'docs/new.md'));
  h.settings['documentation.include'] = 'docs/**'; await h.action('refresh'); assert.equal(h.latest('documentation').files.length, 2);
  h.settings['documentation.include'] = 'missing/**'; await h.action('refresh'); assert.equal(h.latest('documentation').files.length, 0);
  h.vscode.workspace.findFiles = async () => {throw new Error('Search unavailable');}; await h.action('refresh'); assert.match(h.latest('documentation').error, /Search unavailable/);
});

test('watchers debounce changes, live edits update previews, and disposal removes listeners', async () => {
  const h = host(); await h.open(); await h.action('open', '/repo/docs/guide.md');
  h.files.set('/repo/docs/guide.md', '# Edited'); h.text.fire({document: h.getDocument(h.uri('/repo/docs/guide.md'))});
  await new Promise(resolve => setTimeout(resolve, 220)); assert.match(h.latest('render').html, /Edited/);
  const count = h.queries.length; h.files.set('/repo/docs/added.md', '# Added');
  h.watchers[0].create(h.uri('/repo/docs/added.md')); h.watchers[0].remove(h.uri('/repo/old-folder'));
  await new Promise(resolve => setTimeout(resolve, 400)); assert.equal(h.queries.length, count + 2);
  assert.ok(h.latest('documentation').files.some(file => file.path === 'docs/added.md'));
  h.vscode.workspace.workspaceFolders = [h.vscode.workspace.workspaceFolders[0]]; h.workspaceFolders.fire();
  await new Promise(setImmediate); assert.ok(h.watchers[0].disposed); assert.equal(h.latest('documentation').files.some(file => file.rootName === 'other'), false);
  h.panels[0].dispose(); assert.ok(h.watchers.every(watcher => watcher.disposed)); assert.equal(h.text.listeners.size, 0);
});

test('latest selection and scan win races; late work cannot update disposed panels', async () => {
  const h = host(); await h.open();
  let finish;
  const normalOpen = h.vscode.workspace.openTextDocument;
  h.vscode.workspace.openTextDocument = target => target.path.endsWith('README.md') ? new Promise(resolve => {finish = () => resolve(h.getDocument(target));}) : normalOpen(target);
  const first = h.action('open', '/repo/README.md'); await h.action('open', '/repo/docs/guide.md'); finish(); await first;
  assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md');
  const originalSearch = h.vscode.workspace.findFiles; const scans = [];
  h.vscode.workspace.findFiles = (...args) => new Promise(resolve => scans.push(() => originalSearch(...args).then(resolve)));
  const old = h.action('refresh'); const next = h.action('refresh');
  await Promise.all(scans.slice(2).map(resolve => resolve())); await next;
  const messages = h.messages.length;
  await Promise.all(scans.slice(0, 2).map(resolve => resolve())); await old; assert.equal(h.messages.length, messages);
  const pending = h.action('open', '/repo/README.md'); h.panels[0].dispose(); finish(); await pending; assert.equal(h.messages.length, messages);
});


test('single-file links open source with Unicode and duplicate heading selection/reveal', async () => {
  const h = host();
  h.files.set('/repo/docs/guide.md', ['---', 'label: Example', '---', '', '# Caf\u00e9 \u65e5\u672c\u8a9e', '# Details', '# Details-1', '# Details', '# ![Architecture](a.png)'].join('\n'));
  await h.openSingle();
  for (const [anchor, line] of [['caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E', 4], ['details-2', 7], ['architecture', 8]]) {
    await h.panels[0].message({type: 'link', href: `docs/guide.md?view=source#${anchor}`});
    assert.equal(h.opened.at(-1), '/repo/docs/guide.md');
    assert.equal(h.selections.at(-1).start.line, line);
    assert.equal(h.reveals.at(-1).range, h.selections.at(-1));
    assert.equal(h.reveals.at(-1).type, 2);
  }
  await h.panels[0].message({type: 'reference', id: h.latest('render').references[0].id});
  assert.equal(h.selections.at(-1).start.line, 5);
  assert.equal(h.panels.length, 1);
});

test('Home preserves fragments and query-free paths; same-file links stay in their preview', async () => {
  for (const mode of ['home', 'single']) {
    const h = host();
    if (mode === 'home') { await h.open(); await h.action('open', '/repo/README.md'); } else await h.openSingle();
    await h.panels[0].message({type: 'link', href: 'README.md#Welcome'});
    assert.equal(h.latest('render').documentId, 'file:///repo/README.md');
    assert.equal(h.latest('render').fragment, 'Welcome');
    assert.equal(h.opened.length, 0);
    assert.match(h.warnings.at(-1), /not found/);
    await h.panels[0].message({type: 'link', href: '#welcome'});
    assert.equal(h.latest('render').fragment, 'welcome');
    if (mode === 'home') {
      await h.panels[0].message({type: 'link', href: 'docs/guide.md?view=1#details'});
      assert.equal(h.latest('render').fragment, 'details');
      assert.equal(h.latest('render').documentId, 'file:///repo/docs/guide.md');
      assert.equal(h.opened.length, 0);
    }
  }
});

test('missing, malformed, line fragments and executable schemes have explicit safe outcomes', async () => {
  const h = host(); await h.openSingle();
  for (const [fragment, warning] of [['absent', /not found/], ['%ZZ', /percent encoding/], ['L2-L4', /Go to Line/]]) {
    await h.panels[0].message({type: 'link', href: `docs/guide.md#${fragment}`});
    assert.equal(h.opened.at(-1), '/repo/docs/guide.md');
    assert.equal(h.selections.at(-1), undefined);
    assert.match(h.warnings.at(-1), warning);
  }
  await h.panels[0].message({type: 'link', href: 'src/app.ts#L1-L3'});
  assert.match(h.warnings.at(-1), /Go to Line/);
  assert.equal(h.opened.at(-1), '/repo/src/app.ts');
  const count = h.opened.length;
  for (const href of ['command:workbench.action.closeWindow', 'exec:danger', '//evil/file.md', 'command%3Adanger', 'exec%3Adanger', 'bad%00.md'])
    await h.panels[0].message({type: 'link', href});
  assert.equal(h.opened.length, count);
});


test('encoded separators in filenames remain path characters in links and references', async () => {
  const h = host();
  h.files.set('/repo/docs/hash # query ? percent % caf\u00e9.md', '# Details');
  await h.openSingle();
  await h.panels[0].message({type: 'link', href: 'docs/hash%20%23%20query%20%3F%20percent%20%25%20caf%C3%A9.md?view=1#details'});
  assert.equal(h.opened.at(-1), '/repo/docs/hash # query ? percent % caf\u00e9.md');
  assert.equal(h.selections.at(-1).start.line, 0);
  await h.panels[0].message({type: 'link', href: 'src/app.ts#named-section'});
  assert.match(h.warnings.at(-1), /supported only for Markdown/);
});


test('Home warns about missing and malformed fragments while preserving navigation history', async () => {
  const h = host(); await h.open(); await h.action('open', '/repo/README.md');
  for (const [fragment, warning] of [['missing', /not found/], ['%ZZ', /percent encoding/], ['L2', /Go to Line/]]) {
    await h.panels[0].message({type: 'link', href: `docs/guide.md#${fragment}`});
    assert.equal(h.latest('render').fragment, fragment);
    assert.match(h.warnings.at(-1), warning);
    await h.action('back');
    assert.equal(h.latest('render').documentId, 'file:///repo/README.md');
  }
  await h.panels[0].message({type: 'link', href: 'src/app.ts#%ZZ'});
  assert.equal(h.opened.at(-1), '/repo/src/app.ts');
  assert.match(h.warnings.at(-1), /percent encoding/);
});
