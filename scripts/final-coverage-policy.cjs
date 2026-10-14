const { createCoverageMap } = require('istanbul-lib-coverage');
const thresholds = { lines: 95, statements: 95, functions: 95, branches: 90 };
const moduleName = (file) => file.replaceAll('\\', '/').split('/src/').pop();
function changedLines(diff) {
  const result = {};
  let file,
    expectingHeader = true;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      file = undefined;
      expectingHeader = true;
    } else if (expectingHeader && line.startsWith('+++ ')) {
      let destination = line.slice(4);
      if (destination.startsWith('"')) {
        try {
          destination = JSON.parse(destination);
        } catch {
          throw Error('Unsupported quoted source diff path; cannot establish changed coverage');
        }
      }
      if (destination !== '/dev/null' && !destination.startsWith('b/'))
        throw Error('Unexpected source diff path: ' + destination);
      file = destination === '/dev/null' ? undefined : destination.slice(2);
      expectingHeader = false;
    } else {
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
    const intersects = (loc) => [...lines].some((line) => line >= loc.start.line && line <= loc.end.line);
    const lineCounts = Object.entries(fc.getLineCoverage())
      .filter(([line]) => lines.has(Number(line)))
      .map(([, count]) => count);
    const functionCounts = Object.entries(fc.fnMap)
      .filter(([, fn]) => intersects(fn.loc))
      .map(([id]) => fc.f[id]);
    const branchCounts = Object.entries(fc.branchMap)
      .filter(([, branch]) => intersects(branch.loc) || branch.locations.some(intersects))
      .flatMap(([id]) => fc.b[id]);
    for (const [metric, counts] of Object.entries({
      lines: lineCounts,
      functions: functionCounts,
      branches: branchCounts,
    })) {
      const covered = counts.filter((count) => count > 0).length;
      if (counts.length && (covered / counts.length) * 100 < thresholds[metric])
        failures.push(
          'Changed ' + metric + ' ' + name + ': ' + covered + '/' + counts.length + ' < ' + thresholds[metric] + '%',
        );
    }

    if (selected.length && (covered / selected.length) * 100 < thresholds.statements)
      failures.push(`Changed statements ${name}: ${covered}/${selected.length} < ${thresholds.statements}%`);
  }
  return failures;
}
module.exports = { finalCheck, changedLines, thresholds };
