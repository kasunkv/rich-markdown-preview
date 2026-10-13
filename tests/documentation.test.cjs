const {test} = require('node:test');
const assert = require('node:assert/strict');
const {host} = require('./documentation-host.cjs');

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

test('long navigation keeps a useful bounded Back/Forward window', async () => {
  const h = host();
  for (let index = 0; index < 100; index++) h.files.set(`/repo/history/${index}.md`, `# Entry ${index}`);
  await h.open();
  for (let index = 0; index < 100; index++) await h.action('open', `/repo/history/${index}.md`);
  for (let index = 0; index < 63; index++) await h.action('back');
  assert.equal(h.latest('render').documentId, 'file:///repo/history/36.md');
  assert.equal(h.latest('documentation').canBack, false);
  await h.action('back');
  assert.equal(h.latest('render').documentId, 'file:///repo/history/36.md');
  await h.action('forward');
  assert.equal(h.latest('render').documentId, 'file:///repo/history/37.md');
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
  h.vscode.workspace.findFiles = async () => {throw new Error('Search unavailable');}; await h.action('refresh'); assert.match(h.latest('documentation').error, /Retry and check workspace access/);
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
  scans[1](); await new Promise(setImmediate);
  scans[2](); await next;
  const messages = h.messages.length;
  scans[0](); await old; assert.equal(h.messages.length, messages);
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

test('failed and stale documentation operations keep boundaries useful without provider details',async()=>{
  const h=host();await h.open();await h.action('open','/repo/README.md');h.files.delete('/repo/docs/guide.md');await h.action('open','/repo/docs/guide.md');assert.match(h.warnings.at(-1),/Could not open this document/);assert.equal(h.latest('render').documentId,'file:///repo/README.md');
  h.files.set('/repo/docs/guide.md','# Guide');h.settings['documentation.exclude']='**/README.md';h.vscode.workspace.getWorkspaceFolder=()=>undefined;await h.action('refresh');await new Promise(setImmediate);assert.equal(h.latest('render').documentId,'home');
});
test('pending selected-document stat cannot navigate a newer or disposed preview',async()=>{
  for(const dispose of [false,true]){
    const h=host();await h.open();await h.action('open','/repo/README.md');h.settings['documentation.exclude']='**/README.md';let reject;h.vscode.workspace.fs.stat=()=>new Promise((_,no)=>{reject=no;});await h.action('refresh');
    if(dispose)h.panels[0].dispose();else await h.action('open','/repo/docs/guide.md');const count=h.messages.length;reject(Error('private provider'));await new Promise(setImmediate);assert.equal(h.messages.length,count);if(!dispose)assert.equal(h.latest('render').documentId,'file:///repo/docs/guide.md');h.panels[0].dispose();
  }
});
test('navigation delivery completion is ignored after disposal',async()=>{
  const h=host();await h.open();const completions=[];h.panels[0].webview.postMessage=()=>new Promise(resolve=>completions.push(resolve));const refresh=h.action('refresh');await refresh;h.panels[0].dispose();completions.forEach(resolve=>resolve(true));await new Promise(setImmediate);await h.panels[0].message({type:'ready'});h.configuration.fire({affectsConfiguration:()=>true});assert.ok(h.watchers.every(w=>w.disposed));
});

test('dependency event storms skip scans but folder rename, deletion and hidden docs refresh', async () => {
  const h = host(); await h.open();
  const initial = h.queries.length;
  for (let i = 0; i < 300; i++) h.watchers[0].create(h.uri(`/repo/node_modules/pkg-${i}/index.js`));
  h.watchers[0].create(h.uri('/repo/src/app.ts'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(h.queries.length, initial);

  h.files.delete('/repo/reports/2026/october/summary.MD');
  h.files.set('/repo/reports/2026/november/summary.MD', '# Moved');
  h.watchers[0].remove(h.uri('/repo/reports/2026/october'));
  h.watchers[0].create(h.uri('/repo/reports/2026/november'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(h.latest('documentation').files.some(file => file.path === 'reports/2026/november/summary.MD'));
  assert.ok(!h.latest('documentation').files.some(file => file.path === 'reports/2026/october/summary.MD'));

  h.files.set('/repo/.claude/skills/new/SKILL.md', '# Hidden');
  h.watchers[0].create(h.uri('/repo/.claude/skills/new'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(h.latest('documentation').files.some(file => file.path === '.claude/skills/new/SKILL.md'));
  h.settings['documentation.exclude'] = '';
  h.files.set('/repo/node_modules/pkg/configured.md', '# Configured');
  h.watchers[0].create(h.uri('/repo/node_modules/pkg/configured.md'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(h.latest('documentation').files.some(file => file.path === 'node_modules/pkg/configured.md'));
});

test('10k result cap marks truncation and bounds provider requests across roots', async () => {
  const h = host();
  for (let i = 0; i < 10020; i++) h.files.set(`/repo/docs/bulk/${String(i).padStart(5, '0')}.md`, '# Bulk');
  const started = performance.now();
  await h.open();
  const elapsed = performance.now() - started;
  const result = h.latest('documentation');
  assert.equal(result.files.length, 10000);
  assert.equal(result.truncated, true);
  assert.ok(h.queries.every(query => query.max <= 10001));
  assert.ok(h.queries.some(query => query.max === 1));
  assert.equal(new Set(result.files.map(file => file.id)).size, result.files.length);
  console.log(`10k-index-fixture=${elapsed.toFixed(1)}ms`);
});

test('virtual roots with identical paths keep authority and relative paths isolated', async () => {
  const h = host();
  const uri = (authority, path) => ({
    scheme: 'vscode-remote', authority, path, fsPath: path,
    toString: () => `vscode-remote://${authority}${path}`
  });
  h.vscode.workspace.workspaceFolders = [
    {name: 'alpha', uri: uri('alpha', '/docs')},
    {name: 'beta', uri: uri('beta', '/docs')}
  ];
  h.vscode.workspace.findFiles = async pattern => [
    uri(pattern.baseUri.authority, '/docs/nested/guide.md'),
    uri(pattern.baseUri.authority === 'alpha' ? 'beta' : 'alpha', '/docs/foreign.md'),
    uri(pattern.baseUri.authority, '/docs-elsewhere/escape.md')
  ];
  await h.open();
  const files = h.latest('documentation').files;
  assert.equal(files.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(files.map(file => [file.rootName, file.path]))), [
    ['alpha', 'nested/guide.md'], ['beta', 'nested/guide.md']
  ]);
  assert.notEqual(files[0].id, files[1].id);
});

test('opaque provider index uses bounded scanner, excludes symlinks, and clears removed roots', async () => {
  const h = host();
  const uri = path => ({scheme:'memory', authority:'fixture', path, fsPath:path,
    toString:() => `memory://fixture${path}`});
  const originalJoin = h.vscode.Uri.joinPath;
  h.vscode.Uri.joinPath = (base, ...parts) => base.scheme === 'memory'
    ? uri(require('node:path').posix.join(base.path, ...parts)) : originalJoin(base, ...parts);
  h.vscode.workspace.workspaceFolders = [{name:'virtual', uri:uri('/docs')}];
  h.vscode.workspace.fs.stat = async target => ({type: target.path === '/docs' ? 2 : 1});
  const reads = [];
  h.vscode.workspace.fs.readDirectory = async target => {
    reads.push(target.path);
    if (target.path === '/docs') return [['bulk',2],['node_modules',2],['linked.md',65],['.hidden',2]];
    if (target.path === '/docs/.hidden') return [['SKILL.md',1]];
    if (target.path === '/docs/bulk') return Array.from({length:5100},(_,i)=>[`${String(i).padStart(5,'0')}.md`,1]);
    throw Error('Excluded folder must not be read');
  };
  h.vscode.workspace.findFiles = async () => {throw Error('Opaque provider must use shared scanner');};
  await h.open();
  const snapshot = h.latest('documentation');
  assert.equal(snapshot.files.length,5000);
  assert.equal(snapshot.truncated,true);
  assert.equal(snapshot.complete,false);
  assert.ok(snapshot.files.every(file => file.root === 'memory://fixture/docs'));
  assert.ok(!reads.includes('/docs/node_modules'));
  assert.ok(!snapshot.files.some(file => file.path === 'linked.md'));
  h.vscode.workspace.workspaceFolders = [];
  h.workspaceFolders.fire();
  await new Promise(setImmediate);
  assert.equal(h.latest('documentation').files.length,0);
  assert.equal(h.latest('documentation').complete,true);
  assert.equal(h.latest('documentation').roots.length,0);
});

test('late directory stat from a removed root cannot start another scan', async () => {
  const h=host();await h.open();
  let completeStat;
  h.vscode.workspace.fs.stat=()=>new Promise(resolve=>{completeStat=resolve;});
  h.watchers[0].create(h.uri('/repo/new-folder'));
  h.vscode.workspace.workspaceFolders=[h.vscode.workspace.workspaceFolders[1]];
  h.workspaceFolders.fire();
  await new Promise(setImmediate);
  const afterRemoval=h.queries.length;
  completeStat({type:2});
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(h.queries.length,afterRemoval);
});
