const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const URI = {
  file: (value) => URI.parse(pathToFileURL(value).href),
  parse: (value) => {
    const url = new URL(value);
    const uri = {
      scheme: url.protocol.slice(0, -1),
      authority: url.host,
      path: decodeURIComponent(url.pathname),
      query: url.search.slice(1),
      fragment: url.hash.slice(1),
      get fsPath() {
        return fileURLToPath('file://' + this.authority + this.path.split('/').map(encodeURIComponent).join('/'));
      },
      with(changes) {
        const copy = { ...this, ...changes };
        Object.defineProperty(copy, 'fsPath', {
          get() {
            return fileURLToPath('file://' + this.authority + this.path.split('/').map(encodeURIComponent).join('/'));
          },
        });
        copy.with = this.with;
        copy.toString = this.toString;
        return copy;
      },
      toString() {
        return (
          this.scheme +
          '://' +
          this.authority +
          this.path.split('/').map(encodeURIComponent).join('/') +
          (this.query ? '?' + this.query : '') +
          (this.fragment ? '#' + this.fragment : '')
        );
      },
    };
    return uri;
  },
};
const Utils = {
  joinPath: (base, ...parts) => base.with({ path: path.posix.join(base.path, ...parts), query: '', fragment: '' }),
};
const source = path.resolve('src/resources.ts');
const ts = require('typescript');
const contents = process.env.SOURCE_COVERAGE_ROOT
  ? require('../scripts/coverage-instrument.cjs').instrument(source).code
  : fs.readFileSync(source, 'utf8');
function loadUrl() {
  const filename = path.resolve('src/resource-url.ts');
  const contents = process.env.SOURCE_COVERAGE_ROOT
    ? require('../scripts/coverage-instrument.cjs').instrument(filename).code
    : fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(contents, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { module, exports: module.exports, __coverage__: (globalThis.__coverage__ ??= {}) },
  );
  return module.exports;
}
const moduleObject = { exports: {} };
const canonicalAccess = [];
let workspaceRoot;
const vscode = {
  Uri: { joinPath: Utils.joinPath, parse: URI.parse },
  workspace: {
    isTrusted: true,
    getWorkspaceFolder: (uri) =>
      workspaceRoot &&
      uri.scheme === workspaceRoot.scheme &&
      uri.authority === workspaceRoot.authority &&
      (uri.path === workspaceRoot.path || uri.path.startsWith(workspaceRoot.path + '/'))
        ? { uri: workspaceRoot }
        : undefined,
  },
};
vm.runInNewContext(
  ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    .outputText,
  {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (name) =>
      name === 'vscode'
        ? vscode
        : name === './resource-url'
          ? loadUrl()
          : name === 'node:fs'
            ? {
                ...fs,
                realpathSync: (value) => { canonicalAccess.push({type:'realpath',value}); return value.endsWith('literal?.svg') ? value : fs.realpathSync(value); },
                statSync: (value) => { canonicalAccess.push({type:'stat',value}); return value.endsWith('literal?.svg') ? { isFile: () => true } : fs.statSync(value); },
              }
            : require(name),
    __coverage__: (globalThis.__coverage__ ??= {}),
  },
);
const policy = moduleObject.exports;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rmp-resources-'));
const root = path.join(temporary, 'workspace');
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(path.join(root, 'assets'));
fs.writeFileSync(path.join(root,'docs','guide.md'),'# Fixture');
for (const name of ['diagram.svg', 'space image.svg', 'literal#.svg'])
  fs.writeFileSync(path.join(root, 'assets', name), '<svg/>');
fs.writeFileSync(path.join(temporary, 'secret.svg'), '<svg/>');
const document = URI.file(path.join(root, 'docs', 'guide.md'));
const converted = [];
const webview = {
  asWebviewUri: (uri) => {
    converted.push(uri);
    return uri.with({ scheme: 'safe-resource' });
  },
};

test('URL parser splits raw suffixes before filename decoding', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(policy.parseResourceUrl('a%23b%3Fc.svg?v=1#view'))), {
    path: 'a%23b%3Fc.svg',
    query: 'v=1',
    fragment: 'view',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(policy.parseResourceUrl('plain.svg'))), {
    path: 'plain.svg',
    query: '',
    fragment: '',
  });
  assert.equal(policy.parseResourceUrl('a.svg#view?inside').query, '');
});
test('workspace sibling resources preserve filenames and URI query/fragment metadata', () => {
  workspaceRoot = URI.file(root);
  for (const encoded of ['diagram.svg', 'space%20image.svg', 'literal%23.svg', 'literal%3F.svg']) {
    const result = policy.resolveImageResource(`../assets/${encoded}?v=2#view`, document, webview);
    assert.ok(result.startsWith('safe-resource:'), encoded);
    assert.equal(converted.at(-1).fsPath, path.join(root, 'assets', decodeURIComponent(encoded)));
    assert.equal(URI.parse(result).query, 'v=2');
    assert.equal(URI.parse(result).fragment, 'view');
  }
  assert.ok(policy.resolveImageResource('../assets/space image.svg', document, webview));
  assert.ok(
    policy.resolveImageResource(URI.file(path.join(root, 'assets', 'diagram.svg')).toString(), document, webview),
  );
  assert.equal(policy.documentResourceRoot(document).fsPath, root);
  const roots = policy.previewResourceRoots(URI.file('/extension'), document);
  assert.equal(roots.length, 3);
  assert.ok(roots[0].path.endsWith('/extension/dist'));
  assert.ok(roots[1].path.endsWith('/extension/assets'));
  assert.equal(roots[2].fsPath, root);
  assert.equal(policy.previewResourceRoots(URI.file('/extension')).length, 2);
});
test('standalone directory, missing and malformed images fail closed without widening roots', () => {
  workspaceRoot = undefined;
  assert.equal(policy.resolveImageResource('../assets/diagram.svg', document, webview), '');
  fs.writeFileSync(path.join(root, 'docs', 'inline.svg'), '<svg/>');
  assert.ok(policy.resolveImageResource('inline.svg', document, webview));
  assert.equal(policy.documentResourceRoot(document).fsPath, path.join(root, 'docs'));
  for (const src of [
    '',
    'missing.svg',
    '%broken',
    '%00.svg',
    'dir\\image.svg',
    '/secret.svg',
    '../../secret.svg',
    'command:bad',
    'file:///missing.svg',
    '../assets',
  ])
    assert.equal(policy.resolveImageResource(src, document, webview), '', src);
});
test('workspace escape, symlink escape and unsupported providers fail closed; remote policy stays separate', () => {
  workspaceRoot = URI.file(root);
  assert.equal(policy.resolveImageResource('../../secret.svg', document, webview), '');
  fs.symlinkSync(temporary, path.join(root, 'escape'), 'junction');
  assert.equal(policy.resolveImageResource('../escape/secret.svg', document, webview), '');
  fs.symlinkSync(path.join(root, 'assets'), path.join(root, 'alias'), 'junction');
  assert.ok(policy.resolveImageResource('../alias/diagram.svg', document, webview));
  const provider = URI.parse('vscode-remote://host/work/docs/guide.md');
  workspaceRoot = URI.parse('vscode-remote://host/work');
  assert.equal(policy.resolveImageResource('../assets/diagram.svg', provider, webview), '');
  assert.equal(policy.resolveImageResource('vscode-remote://host/work/assets/diagram.svg', document, webview), '');
  for (const remote of [
    'https://example.invalid/image.svg',
    'http://example.invalid/image.svg',
    'data:image/png;base64,AA==',
    '//example.invalid/image.svg',
  ])
    assert.equal(policy.resolveImageResource(remote, document, webview), remote);
});
process.on('exit', () => {
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('rmp-resources-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('Restricted Mode navigation requires a canonical local workspace file', () => {
  workspaceRoot = URI.file(root);
  const safe = URI.file(path.join(root, 'assets', 'diagram.svg'));
  assert.equal(policy.restrictedNavigationAllowed(safe), true);
  assert.equal(policy.restrictedNavigationAllowed(URI.file(path.join(root, 'alias', 'diagram.svg'))), true);
  for (const candidate of [
    URI.file(path.join(temporary, 'secret.svg')),
    URI.file(path.join(root, 'escape', 'secret.svg')),
    URI.file(path.join(root, 'missing.md')),
    URI.file(path.join(root, 'assets')),
    URI.parse('command://open/private.md'),
    URI.parse('file://other-host' + safe.path),
  ]) assert.equal(policy.restrictedNavigationAllowed(candidate), false, candidate.toString());
  workspaceRoot = undefined;
  assert.equal(policy.restrictedNavigationAllowed(safe), false);
  workspaceRoot = URI.parse('vscode-remote://host/work');
  assert.equal(policy.restrictedNavigationAllowed(URI.parse('vscode-remote://host/work/guide.md')), false);
});

test('Restricted Mode rejects lexical outside targets before filesystem discovery', () => {
  workspaceRoot = URI.file(root);
  canonicalAccess.length = 0;
  assert.equal(policy.restrictedNavigationAllowed(URI.file(path.join(temporary, 'secret.svg'))), false);
  assert.deepEqual(canonicalAccess, []);
  assert.equal(policy.restrictedNavigationAllowed(URI.file(path.join(root, 'escape', 'secret.svg'))), false);
  assert.ok(canonicalAccess.some(entry => entry.type === 'realpath'));
  assert.ok(!canonicalAccess.some(entry => entry.type === 'stat'), 'Canonical escape is denied before stat');
});

test('Restricted Mode also rejects inconsistent workspace provider roots lexically', () => {
  const resolveFolder = vscode.workspace.getWorkspaceFolder;
  try {
    // Defend even if provider discovery reports a folder for a target outside it.
    vscode.workspace.getWorkspaceFolder = () => ({ uri: URI.file(root) });
    for (const target of [URI.file(temporary), URI.file(path.join(temporary, 'secret.svg'))]) {
      canonicalAccess.length = 0;
      assert.equal(policy.restrictedNavigationAllowed(target), false);
      assert.deepEqual(canonicalAccess, []);
    }
    // Different drives produce an absolute relative path on Windows.
    if (process.platform === 'win32') {
      canonicalAccess.length = 0;
      assert.equal(policy.restrictedNavigationAllowed(URI.file('Z:\\outside.md')), false);
      assert.deepEqual(canonicalAccess, []);
    }
    vscode.workspace.getWorkspaceFolder = () => ({ uri: URI.parse('vscode-remote://host/work') });
    assert.equal(policy.restrictedNavigationAllowed(URI.file(path.join(root, 'assets', 'diagram.svg'))), false);
    vscode.workspace.getWorkspaceFolder = () => ({ uri: URI.file(root).with({authority:'other-host'}) });
    assert.equal(policy.restrictedNavigationAllowed(URI.file(path.join(root, 'assets', 'diagram.svg'))), false);
  } finally { vscode.workspace.getWorkspaceFolder = resolveFolder; }
});

test('Restricted local resource roots never fall back to an outside standalone directory', () => {
  const extension = URI.file(path.join(temporary,'extension'));
  vscode.workspace.isTrusted = false;
  try {
    workspaceRoot = URI.file(root);
    assert.ok(policy.resolveImageResource('../assets/diagram.svg',document,webview));
    workspaceRoot = undefined;
    assert.equal(policy.previewResourceRoots(extension,document).length,2,'Only immutable extension resources remain allowed');
    assert.equal(policy.resolveImageResource('inline.svg',document,webview),'','Standalone image access stays disabled');
    workspaceRoot = URI.file(root);
    assert.ok(policy.resolveImageResource('../assets/diagram.svg',document,webview));
  } finally { vscode.workspace.isTrusted=true; workspaceRoot=undefined; }
});

test('privacy delegates contained file URIs to canonical local authorization and preserves unsupported Windows spellings', () => {
  const {externalImageDecision} = require('./load-external-images.cjs');
  workspaceRoot = URI.file(root);
  const inside = URI.file(path.join(root,'assets','diagram.svg')).toString();
  const outside = URI.file(path.join(temporary,'secret.svg')).toString();
  assert.equal(externalImageDecision(inside,new Set()).kind,'local');
  assert.ok(policy.resolveImageResource(inside,document,webview).startsWith('safe-resource:'));
  assert.equal(externalImageDecision(outside,new Set()).kind,'local');
  assert.equal(policy.resolveImageResource(outside,document,webview),'');
  for (const unsupported of ['C:/assets/diagram.svg','C:\\assets\\diagram.svg','/assets/diagram.svg'])
    assert.equal(policy.resolveImageResource(unsupported,document,webview),'');
});
