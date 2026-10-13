const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.resolve('src/external-images.ts');
const source = process.env.SOURCE_COVERAGE_ROOT
  ? require('../scripts/coverage-instrument.cjs').instrument(filename).code
  : fs.readFileSync(filename, 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleObject, exports: moduleObject.exports, URL, __coverage__: (globalThis.__coverage__ ??= {}) });
module.exports = moduleObject.exports;
