const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { POLICY, hash, validateSource, validateIdentity, releaseTag, verifyCandidate } = require('./release-policy.cjs');
const { validateReleaseVersion } = require('./release-version.cjs');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.test-results/release');
const output = path.join(base, 'candidate');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function emit(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(String(value))) throw Error('Unsafe output');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
function localContext() {
  const manifest = read('package.json'),
    lock = read('package-lock.json');
  validateIdentity(manifest);
  validateReleaseVersion({
    manifest,
    lock,
    release: true,
    changelog: fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
  });
  const reviewedMain = process.argv[3];
  if (!/^[a-f0-9]{40}$/.test(reviewedMain || '')) throw Error('Local rehearsal requires the exact reviewed main SHA');
  const commit = git(['rev-parse', 'HEAD']);
  git(['merge-base', '--is-ancestor', reviewedMain, commit]);
  if (git(['status', '--porcelain'])) throw Error('Local rehearsal source must be clean');
  fs.mkdirSync(base, { recursive: true });
  json(path.join(base, 'context.json'), {
    ...POLICY,
    version: manifest.version,
    tag: releaseTag('v' + manifest.version),
    commit,
    rehearsal: true,
    local: true,
    reviewedMain,
    startedAt: new Date().toISOString(),
  });
}
function context() {
  const manifest = read('package.json'),
    lock = read('package-lock.json');
  const commit = git(['rev-parse', 'HEAD']);
  const rehearsal = process.env.RELEASE_MODE !== 'publish';
  const source = {
    manifest,
    lock,
    changelog: fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
    context: {
      repository: process.env.GITHUB_REPOSITORY,
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      refProtected: process.env.GITHUB_REF_PROTECTED === 'true',
      tag: process.env.GITHUB_REF_NAME,
      commit,
      ...(process.env.RELEASE_TAG ? { manualTag: process.env.RELEASE_TAG } : {}),
    },
  };
  let identity;
  if (!rehearsal) identity = validateSource(source);
  else {
    if (
      source.context.repository !== POLICY.repository ||
      source.context.eventName !== 'workflow_dispatch' ||
      source.context.ref !== 'refs/heads/main' ||
      !source.context.refProtected ||
      process.env.RELEASE_TAG
    )
      throw Error('Dry-run requires protected main without a manual tag');
    validateIdentity(manifest);
    validateReleaseVersion({ ...source, release: true });
    git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
    if (git(['status', '--porcelain'])) throw Error('Dry-run source must be clean');
    identity = { ...POLICY, version: manifest.version, tag: releaseTag(`v${manifest.version}`), commit };
  }
  fs.mkdirSync(base, { recursive: true });
  json(path.join(base, 'context.json'), { ...identity, rehearsal, startedAt: new Date().toISOString() });
  emit({ commit, tag: identity.tag, rehearsal });
}
async function pack() {
  const c = JSON.parse(fs.readFileSync(path.join(base, 'context.json')));
  if (git(['rev-parse', 'HEAD']) !== c.commit) throw Error('Candidate checkout changed');
  fs.mkdirSync(output, { recursive: true });
  if (fs.readdirSync(output).length) throw Error('Candidate output must be empty; never overwrite a retained artifact');
  // Locked VSCE pack is the archive API, unlike packageCommand it does not invoke
  // vscode:prepublish. Coverage has already restored the sole production build.
  const filename = path.join(output, 'candidate.vsix');
  await require('@vscode/vsce/out/package').pack({
    cwd: root,
    packagePath: filename,
    dependencies: false,
    githubBranch: POLICY.branch,
  });
  const report = await require('./verify-release.cjs').verifyRelease({ root, filename, tag: c.tag });
  json(path.join(output, 'vsix-inventory.json'), report);
}
function latest(directory, filename) {
  const choices = fs
    .readdirSync(directory)
    .map((name) => path.join(directory, name, filename))
    .filter((file) => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!choices.length) throw Error('Missing current-run gate evidence: ' + filename);
  return choices[0];
}
function seal() {
  const c = JSON.parse(fs.readFileSync(path.join(base, 'context.json')));
  const coverageFile = latest(path.join(root, '.test-results/coverage'), 'run.json');
  const coverage = JSON.parse(fs.readFileSync(coverageFile));
  const mutationFile = latest(path.join(root, '.test-results/mutations'), 'result.json');
  const mutations = JSON.parse(fs.readFileSync(mutationFile));
  const dependencies = read('.test-results/dependencies/status.json');
  if (
    coverage.status !== 'passed' ||
    coverage.commit !== c.commit ||
    Date.parse(coverage.startedAt) < Date.parse(c.startedAt) ||
    mutations.commit !== c.commit ||
    mutations.failures?.length !== 0 ||
    Date.parse(mutations.finishedAt) < Date.parse(c.startedAt) ||
    !['full', 'runtime'].every((scope) => dependencies.scopes?.[scope]?.passed === true) ||
    Date.parse(dependencies.checkedAt) < Date.parse(c.startedAt)
  )
    throw Error('Stale or failed candidate gate evidence');
  const final = JSON.parse(fs.readFileSync(path.join(path.dirname(coverageFile), 'final-gate.json')));
  if (!Array.isArray(final.failures) || final.failures.length) throw Error('Strict coverage gate missing or failed');
  json(path.join(output, 'gate-evidence.json'), {
    context: c,
    coverage,
    final,
    mutations,
    dependencies,
    requiredCommands: ['check:quality', 'check:dependencies', 'test:coverage', 'test:mutation', 'test:browser:harness'],
    compatibility: 'required separately against this immutable digest before promotion',
  });
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(output, 'package-lock.json'));
  fs.copyFileSync(path.join(root, 'RUNTIME_DEPENDENCIES.json'), path.join(output, 'runtime-dependencies.json'));
  const sbom = execFileSync(process.execPath, [process.env.npm_execpath, 'sbom', '--sbom-format', 'cyclonedx'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (JSON.parse(sbom).bomFormat !== 'CycloneDX') throw Error('Invalid SBOM');
  fs.writeFileSync(path.join(output, 'sbom.cdx.json'), sbom);
  json(path.join(output, 'toolchain.json'), {
    node: process.version,
    npm: execFileSync(process.execPath, [process.env.npm_execpath, '--version'], { encoding: 'utf8' }).trim(),
    vsce: require('@vscode/vsce/package.json').version,
    platform: process.platform,
    arch: process.arch,
    lockSha256: hash(fs.readFileSync(path.join(root, 'package-lock.json'))),
  });
  const digest = hash(fs.readFileSync(path.join(output, 'candidate.vsix')));
  const files = fs
    .readdirSync(output)
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(output, name));
      return { name, bytes: bytes.length, sha256: hash(bytes) };
    });
  const provenance = { schema: 1, ...c, vsix: { name: 'candidate.vsix', sha256: digest }, files };
  json(path.join(output, 'provenance.json'), provenance);
  const provenanceDigest = hash(fs.readFileSync(path.join(output, 'provenance.json')));
  verifyCandidate(output, { digest, provenanceDigest, tag: c.tag, commit: c.commit });
  emit({ digest, provenance_digest: provenanceDigest });
}
function tools() {
  const directory = path.join(base, 'tools');
  fs.mkdirSync(directory, { recursive: true });
  const manifest = read('package.json');
  delete manifest.scripts;
  json(path.join(directory, 'package.json'), manifest);
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(directory, 'package-lock.json'));
  const binding = ['package.json', 'package-lock.json'].map((name) => ({
    name,
    sha256: hash(fs.readFileSync(path.join(directory, name))),
  }));
  json(path.join(directory, 'binding.json'), binding);
  emit({ tools_digest: hash(fs.readFileSync(path.join(directory, 'binding.json'))) });
}
if (require.main === module)
  Promise.resolve()
    .then(() =>
      (
        ({ context, pack, seal, tools })[process.argv[2]] ||
        (() => {
          throw Error('Expected context|pack|seal|tools');
        })
      )(),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { context, localContext, pack, seal, tools };
