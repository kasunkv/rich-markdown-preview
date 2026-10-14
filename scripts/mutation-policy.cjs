function classify(result) {
  if (result.error || result.signal || result.status === null) return 'invalid';
  if (result.status === 0) return 'survived';
  return /failureType: 'testCodeFailure'[\s\S]*?code: 'ERR_ASSERTION'/.test(result.stdout ?? '') ? 'killed' : 'invalid';
}
function checkMutation(results, baseline) {
  const failures = [];
  if (!results.length) failures.push('Empty mutation run');
  for (const result of results) if (result.status !== 'killed') failures.push(result.id + ': ' + result.status);
  for (const id of baseline.killed)
    if (!results.some((result) => result.id === id && result.status === 'killed'))
      failures.push('Mutation ratchet regression: ' + id);
  if (results.length && (results.filter((r) => r.status === 'killed').length / results.length) * 100 < baseline.minimum)
    failures.push('Mutation score below baseline');
  return failures;
}
module.exports = { classify, checkMutation };
