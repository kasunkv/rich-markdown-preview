const { createCoverageMap } = require('istanbul-lib-coverage');
const thresholds = { lines: 95, statements: 95, functions: 95, branches: 90 };
const moduleName = (file) => file.replaceAll('\\', '/').split('/src/').pop();
function changedLines(diff) {
  const result = {};
  let file;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+++ /dev/null')) file = undefined;
    else {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (file && hunk) {
        const lines = (result[file] ??= new Set());
        for (let i = Number(hunk[1]); i < Number(hunk[1]) + Number(hunk[2] ?? 1); i++) lines.add(i);
      }
    }
  }
  return result;
}
function finalCheck({ coverage, inventory, diff = '', safety = [], exceptions = [], now = new Date() }) {
  const failures = [],
    map = createCoverageMap(coverage);
  const files = new Map(map.files().map((file) => [moduleName(file), file]));
  const expected = new Set(inventory.map(moduleName));
  for (const name of expected) if (!files.has(name)) failures.push('Missing inventoried module: ' + name);
  for (const name of files.keys()) if (!expected.has(name)) failures.push('Outside executable inventory: ' + name);
  const verify = (label, summary) => {
    for (const [metric, minimum] of Object.entries(thresholds))
      if (summary[metric].pct < minimum) failures.push(`${label} ${metric}: ${summary[metric].pct}% < ${minimum}%`);
  };
  verify('Global', map.getCoverageSummary().toJSON());
  for (const [name, file] of files) verify(name, map.fileCoverageFor(file).toSummary().toJSON());
  const valid = [];
  for (const e of exceptions) {
    const end = new Date(e.expires),
      target = safety.find((item) => item.module === e.module && item.branch === e.branch);
    if (
      !target ||
      !Number.isInteger(e.arm) ||
      e.arm < 0 ||
      !e.reason ||
      !e.owner ||
      !e.issue ||
      e.kind !== 'technically-unreachable' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? '') ||
      !Number.isFinite(end.getTime()) ||
      end.toISOString().slice(0, 10) !== e.expires ||
      end <= now ||
      end - now > 90 * 86400000
    )
      failures.push('Invalid or expired safety exception: ' + JSON.stringify(e));
    else valid.push(e);
  }
  for (const target of safety) {
    const file = files.get(target.module),
      fc = file && map.fileCoverageFor(file);
    const branch = fc?.branchMap[target.branch];
    if (!branch || JSON.stringify(branch) !== JSON.stringify(target.location)) {
      failures.push('Missing or stale safety branch: ' + target.module + ':' + target.branch);
      continue;
    }
    const counts = fc.b[target.branch];
    for (const e of valid.filter((item) => item.module === target.module && item.branch === target.branch))
      if (e.arm >= counts.length) failures.push('Safety exception arm outside branch: ' + target.module);
    counts.forEach((count, arm) => {
      if (!count && !valid.some((e) => e.module === target.module && e.branch === target.branch && e.arm === arm))
        failures.push('Uncovered safety arm: ' + target.module + ':' + target.branch + ':' + arm);
    });
  }
  for (const [source, lines] of Object.entries(changedLines(diff))) {
    if (!source.startsWith('src/') || !source.endsWith('.ts') || source.endsWith('.d.ts')) continue;
    const name = source.slice(4),
      file = files.get(name);
    if (!file) {
      if (expected.has(name)) failures.push('Changed module missing: ' + name);
      continue;
    }
    const fc = map.fileCoverageFor(file);
    const selected = Object.entries(fc.statementMap).filter(([, loc]) =>
      [...lines].some((line) => line >= loc.start.line && line <= loc.end.line),
    );
    const covered = selected.filter(([id]) => fc.s[id] > 0).length;
    if (selected.length && (covered / selected.length) * 100 < thresholds.statements)
      failures.push(`Changed statements ${name}: ${covered}/${selected.length} < ${thresholds.statements}%`);
  }
  return failures;
}
module.exports = { finalCheck, changedLines, thresholds };
