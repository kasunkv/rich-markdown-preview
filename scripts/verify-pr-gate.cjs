const REQUIRED_JOBS = ['quality', 'coverage', 'host'];

function verifyPrGate(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs))
    throw new Error('Invalid job results');
  const missing = REQUIRED_JOBS.filter(job => !Object.hasOwn(needs, job));
  const unsuccessful = Object.entries(needs)
    .filter(([, value]) => value?.result !== 'success')
    .map(([job, value]) => `${job}: ${value?.result || 'missing result'}`);
  if (missing.length || unsuccessful.length)
    throw new Error(`PR gate failed: ${[...missing.map(job => `${job}: missing`), ...unsuccessful].join(', ')}`);
  return Object.keys(needs);
}

if (require.main === module) {
  try {
    const jobs = verifyPrGate(JSON.parse(process.env.PR_GATE_NEEDS || 'null'));
    console.log(`PR gate passed: ${jobs.join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { REQUIRED_JOBS, verifyPrGate };
