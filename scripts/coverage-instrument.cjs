const fs = require('node:fs');
const path = require('node:path');
const { createInstrumenter } = require('istanbul-lib-instrument');
function sources(directory = path.resolve('src')) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sources(path.join(directory, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
          ? [path.join(directory, entry.name)]
          : [],
    )
    .filter((file) => {
      const coverage = instrument(file).coverage;
      return (
        Object.keys(coverage.statementMap).length ||
        Object.keys(coverage.fnMap).length ||
        Object.keys(coverage.branchMap).length
      );
    })
    .sort();
}
function instrument(file) {
  const instrumenter = createInstrumenter({
    esModules: true,
    // Instrumented bundles must obey the production no-eval CSP too.
    coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false,
    parserPlugins: ['typescript'],
    produceSourceMap: true,
    compact: false,
  });
  const code = instrumenter.instrumentSync(fs.readFileSync(file, 'utf8'), file);
  return { code, coverage: instrumenter.lastFileCoverage(), map: instrumenter.lastSourceMap() };
}
module.exports = { sources, instrument };
