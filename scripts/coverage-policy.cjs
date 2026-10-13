const { createCoverageMap } = require('istanbul-lib-coverage');
const metrics = ['lines', 'statements', 'functions', 'branches'];
function summarize(map) {
  return Object.fromEntries(
    map
      .files()
      .sort()
      .map((file) => [file.replaceAll('\\', '/').split('/src/').pop(), map.fileCoverageFor(file).toSummary().toJSON()]),
  );
}
function check(summary, baseline, exceptions = [], now = new Date()) {
  const failures = [];
  for (const exception of exceptions) {
    if (
      !exception.module ||
      !baseline[exception.module] ||
      !metrics.includes(exception.metric) ||
      !exception.reason ||
      !exception.issue ||
      !exception.owner ||
      !Number.isFinite(exception.minimum) ||
      exception.minimum < 0 ||
      exception.minimum > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(exception.expires) ||
      !Number.isFinite(Date.parse(exception.expires)) ||
      new Date(exception.expires) <= now ||
      new Date(exception.expires) - now > 90 * 86400000
    )
      failures.push('Invalid or expired exception: ' + JSON.stringify(exception));
  }
  for (const [file, previous] of Object.entries(baseline)) {
    if (!summary[file]) {
      failures.push(`Missing module ${file}`);
      continue;
    }
    for (const metric of metrics) {
      const current = summary[file][metric];
      if (current.total < previous[metric].total)
        failures.push(`Denominator shrank: ${file} ${metric}; requires reviewed baseline update`);
      if (
        current.pct < previous[metric].pct &&
        !exceptions.some((e) => e.module === file && e.metric === metric && current.pct >= e.minimum)
      )
        failures.push(`${file} ${metric}: ${current.pct}% < ${previous[metric].pct}%`);
    }
  }
  for (const file of Object.keys(summary))
    if (!baseline[file]) failures.push(`New module ${file} requires a reviewed baseline and targeted behavior tests`);
  return failures;
}
function merge(seed, maps) {
  const result = createCoverageMap(JSON.parse(JSON.stringify(seed)));
  for (const map of maps) {
    for (const [file, coverage] of Object.entries(map)) {
      if (!seed[file]) throw new Error(`Coverage outside first-party inventory: ${file}`);
      for (const property of ['statementMap', 'fnMap', 'branchMap'])
        if (JSON.stringify(coverage[property]) !== JSON.stringify(seed[file][property]))
          throw new Error(`Incompatible coverage locations: ${file} ${property}`);
    }
    result.merge(map);
  }
  return result;
}
module.exports = { summarize, check, merge };
