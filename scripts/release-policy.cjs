const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateReleaseVersion } = require('./release-version.cjs');
const POLICY = Object.freeze({
  repository: 'kasunkv/rich-markdown-preview',
  branch: 'main',
  publisher: 'kasunkodagoda',
  name: 'rich-markdown-preview',
});
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const hash = (data) => createHash('sha256').update(data).digest('hex');
function releaseTag(value) {
  if (typeof value !== 'string' || !TAG.test(value)) throw new Error('Expected protected vX.Y.Z release tag');
  return value;
}
function validateContext(context) {
  if (context.repository !== POLICY.repository || !['push', 'workflow_dispatch'].includes(context.eventName))
    throw new Error('Unapproved repository/event');
  const tag = releaseTag(context.tag);
  // A manual run must itself be dispatched on the protected tag. A branch workflow
  // cannot ask for an unrelated tag and inherit its publication authority.
  if (context.ref !== `refs/tags/${tag}` || context.refProtected !== true)
    throw new Error('Unapproved or unprotected release ref');
  if (context.manualTag !== undefined && releaseTag(context.manualTag) !== tag)
    throw new Error('Manual tag differs from workflow ref');
  if (!SHA.test(context.commit || '')) throw new Error('Invalid release commit');
  return tag;
}
function validateIdentity(manifest) {
  if (manifest.publisher !== POLICY.publisher || manifest.name !== POLICY.name)
    throw new Error('Release publisher/name identity mismatch');
}
function validateSource(
  { manifest, lock, changelog, context },
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
) {
  const tag = validateContext(context);
  validateIdentity(manifest);
  const version = validateReleaseVersion({ manifest, lock, changelog, tag, release: true });
  if (lock.name !== manifest.name || lock.packages?.['']?.name !== manifest.name)
    throw new Error('Lockfile name mismatch');
  if (
    git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]) !== context.commit ||
    git(['rev-parse', 'HEAD']) !== context.commit
  )
    throw new Error('Tag/checkout commit mismatch');
  // execFileSync throws for non-ancestor: no shell, no user-supplied switches.
  git(['merge-base', '--is-ancestor', context.commit, `refs/remotes/origin/${POLICY.branch}`]);
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Release source must be clean');
  return { ...version, ...POLICY, commit: context.commit };
}
function safeFile(directory, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
    throw new Error('Unsafe candidate filename');
  const file = path.join(directory, name);
  if (!fs.lstatSync(file).isFile()) throw new Error('Candidate must contain regular files only');
  return file;
}
// expected digest/commit/tag come from the read-only candidate job outputs,
// not from metadata downloaded beside the VSIX. Artifact IDs are selected by
// that same job; callers must never accept an arbitrary run/artifact input.
function verifyCandidate(directory, expected) {
  if (
    !DIGEST.test(expected.digest || '') ||
    !DIGEST.test(expected.provenanceDigest || '') ||
    !SHA.test(expected.commit || '')
  )
    throw new Error('Missing independently supplied candidate binding');
  releaseTag(expected.tag);
  const bytes = fs.readFileSync(safeFile(directory, 'provenance.json'));
  if (hash(bytes) !== expected.provenanceDigest) throw new Error('Candidate provenance digest mismatch');
  const provenance = JSON.parse(bytes);
  if (
    provenance.schema !== 1 ||
    provenance.commit !== expected.commit ||
    provenance.tag !== expected.tag ||
    provenance.repository !== POLICY.repository ||
    provenance.branch !== POLICY.branch
  )
    throw new Error('Candidate origin mismatch');
  validateIdentity(provenance);
  if (`v${provenance.version}` !== expected.tag) throw new Error('Candidate version mismatch');
  if (provenance.vsix?.sha256 !== expected.digest) throw new Error('Candidate digest binding mismatch');
  const files = provenance.files;
  if (!Array.isArray(files) || !files.length || new Set(files.map((item) => item.name)).size !== files.length)
    throw new Error('Invalid candidate file inventory');
  const expectedFiles = ['provenance.json', ...files.map((item) => item.name)].sort();
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expectedFiles))
    throw new Error('Unexpected or missing candidate files');
  for (const item of files) {
    if (!DIGEST.test(item.sha256 || '')) throw new Error('Invalid candidate file digest');
    const data = fs.readFileSync(safeFile(directory, item.name));
    if (data.length !== item.bytes || hash(data) !== item.sha256)
      throw new Error('Candidate file digest/size mismatch');
  }
  if (!files.some((item) => item.name === provenance.vsix.name && item.sha256 === expected.digest))
    throw new Error('VSIX missing from inventory');
  if (!provenance.vsix.name.endsWith('.vsix')) throw new Error('Candidate VSIX extension mismatch');
  return { provenance, vsix: safeFile(directory, provenance.vsix.name) };
}
module.exports = { POLICY, hash, releaseTag, validateContext, validateIdentity, validateSource, verifyCandidate };
