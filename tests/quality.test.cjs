const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('quality checks reject floating privileged Thenables, void escapes and async predicates', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({
    cwd: path.resolve(__dirname, '..'),
    // This test repeatedly lints different text at the same filename. CI's
    // single-run optimization must not reuse an immutable TypeScript program.
    overrideConfig: { languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } },
  });
  const prefix = "import * as vscode from 'vscode';\n";
  const cases = [
    ['vscode.env.clipboard.writeText("fixture");', '@typescript-eslint/no-floating-promises'],
    [
      'void vscode.workspace.fs.writeFile(vscode.Uri.file("/fixture"), new Uint8Array());',
      '@typescript-eslint/no-floating-promises',
    ],
    [
      'vscode.env.openExternal(vscode.Uri.parse("https://example.invalid"));',
      '@typescript-eslint/no-floating-promises',
    ],
    ['vscode.commands.executeCommand("fixture").then(() => {});', '@typescript-eslint/no-floating-promises'],
    ['vscode.workspace.getConfiguration("fixture").update("key", true);', '@typescript-eslint/no-floating-promises'],
    ['[1].filter(async () => true);', '@typescript-eslint/no-misused-promises'],
  ];
  for (const [source, rule] of cases) {
    const [result] = await eslint.lintText(prefix + source, {
      filePath: path.resolve(__dirname, '../src/extension.ts'),
    });
    assert.ok(
      result.messages.some((message) => message.ruleId === rule),
      `${source}: ${JSON.stringify(result.messages)}`,
    );
  }
  const [safe] = await eslint.lintText(
    prefix + 'async function copy() { await vscode.env.clipboard.writeText("fixture"); }\ncopy().catch(console.error);',
    { filePath: path.resolve(__dirname, '../src/extension.ts') },
  );
  assert.equal(safe.errorCount, 0, JSON.stringify(safe.messages));
});

test('formatter detects drift and normalizes source consistently', async () => {
  const prettier = await import('prettier');
  const options = {
    ...(await prettier.resolveConfig(path.resolve(__dirname, '../src/async.ts'))),
    parser: 'typescript',
  };
  const drift = 'export const value={ text:"fixture"}\r\n';
  assert.equal(await prettier.check(drift, options), false);
  const formatted = await prettier.format(drift, options);
  assert.equal(await prettier.check(formatted, options), true);
  assert.ok(formatted.includes("'fixture'"));
  assert.ok(!formatted.includes('\r'));
});

test('detached work observes native promises and rejecting VS Code Thenables', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/async.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const failures = [];
  vm.runInNewContext(output, { exports, console: { error: (...args) => failures.push(args) } });
  const native = new Error('native fixture');
  const thenable = new Error('Thenable fixture');
  exports.reportAsync(Promise.reject(native));
  exports.reportAsync({ then: (_resolve, reject) => reject(thenable) });
  exports.reportAsync(Promise.resolve(true));
  await new Promise(setImmediate);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((args) => args.length === 1 && /Retry the action/.test(args[0])));
  assert.ok(!JSON.stringify(failures).includes('fixture'));
});
