// Pure recovery orchestration. Production transport is deliberately not wired
// until final quality gates and publisher administration have been reviewed.
function matchRemote(candidate, remote) {
  if (
    !remote ||
    remote.publisher !== candidate.publisher ||
    remote.name !== candidate.name ||
    remote.version !== candidate.version ||
    remote.sha256 !== candidate.sha256 ||
    remote.installable !== true
  )
    throw new Error('Existing Marketplace version is unverified or differs from the candidate');
  return remote;
}
async function reconcile(candidate, { inspect, wait = async () => {}, attempts = 5 }) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    throw new Error('Invalid reconciliation retry bound');
  for (let index = 0; index < attempts; index++) {
    const remote = await inspect(candidate);
    if (remote) return matchRemote(candidate, remote);
    if (index + 1 < attempts) await wait(Math.min(1000 * 2 ** index, 10000));
  }
  throw new Error(
    'Marketplace distribution is still unconfirmed; retain candidate and reconcile without another upload',
  );
}
async function promote(candidate, transport) {
  // An existing version can only be reconciled after proving identical bytes and
  // installability. There is no skipDuplicate, unpublish or PAT fallback path.
  const existing = await transport.inspect(candidate);
  if (existing) return { status: 'reconciled', remote: matchRemote(candidate, existing) };
  try {
    await transport.upload(candidate);
  } catch (error) {
    // Timeouts/409s may occur after acceptance. Never blindly repeat the upload.
    try {
      return { status: 'reconciled-after-upload-error', remote: await reconcile(candidate, transport) };
    } catch {
      throw new Error('Upload outcome is uncertain; reconcile the same immutable artifact before retrying', {
        cause: error,
      });
    }
  }
  return { status: 'published', remote: await reconcile(candidate, transport) };
}
module.exports = { matchRemote, reconcile, promote };
