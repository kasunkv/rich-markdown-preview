const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVersion, validateReleaseVersion, validateReleaseNotes } = require('../scripts/release-version.cjs');

function fixture(version) {
  return { manifest: { version }, lock: { version, packages: { '': { version } } } };
}

test('version contract accepts bumps, prereleases and build metadata without release notes or tags in development', () => {
  for (const version of ['0.0.0', '3.2.1', '3.0.0-beta.1', '3.0.0-0.a-b+build.001']) {
    assert.equal(validateReleaseVersion(fixture(version)).version, version);
    assert.equal(validateReleaseVersion({ ...fixture(version), release: true,
      tag: `v${version}`, changelog: `## Unreleased\n\n- Future work\n\n## ${version} — 2026-10-12\n\n- Release changes\n` }).release, true);
  }
  for (const version of [undefined, null, 3, '', 'v3.0.0', '3.0', '03.0.0', '3.00.0', '3.0.00',
    '3.0.0-01', '3.0.0-a.01', '3.0.0-', '3.0.0+', '3.0.0-a..b', '3.0.0+foo..bar', '3.0.0_a', ' 3.0.0', '3.0.0\n']) {
    assert.throws(() => validateVersion(version), /must be valid SemVer/);
  }
});

test('both lockfile root versions and every supplied tag must exactly match the manifest', () => {
  const data = fixture('3.1.0');
  assert.throws(() => validateReleaseVersion({ ...data, lock: { ...data.lock, version: '3.0.0' } }), /package-lock.json version mismatch: expected 3.1.0/);
  for (const packages of [{ '': { version: '3.0.0' } }, {}, undefined]) {
    assert.throws(() => validateReleaseVersion({ ...data, lock: { ...data.lock, packages } }), /packages\[""\] version mismatch/);
  }
  for (const tag of ['', '3.1.0', 'v3.0.0', 'refs/tags/v3.1.0']) {
    assert.throws(() => validateReleaseVersion({ ...data, tag }), /Release tag mismatch: expected v3.1.0/);
  }
  assert.doesNotThrow(() => validateReleaseVersion({ ...data, tag: 'v3.1.0' }));
});

test('release validation requires a unique nonempty version section, while development permits Unreleased only', () => {
  const data = fixture('3.1.0');
  const unreleased = '## Unreleased\n\n- Work in progress\n';
  assert.doesNotThrow(() => validateReleaseVersion({ ...data, changelog: unreleased }));
  assert.throws(() => validateReleaseVersion({ ...data, changelog: unreleased, release: true }), /release notes entry for 3.1.0; found 0/);
  for (const changelog of [
    '## 3.1.0\n\n## 3.0.0\n\n- Older notes',
    '## 3.1.0\n\n<!-- Not release notes -->',
    '## 3.1.0\n\n### Added\n\n### Fixed',
  ]) assert.throws(() => validateReleaseNotes(changelog, data.manifest.version), /entry for 3.1.0 is empty/);
  assert.throws(() => validateReleaseNotes('## 3.1.0\n- One\n## [3.1.0] - 2026-10-12\n- Two', '3.1.0'), /found 2/);
  assert.throws(() => validateReleaseNotes('```md\n## 3.1.0\n- Fake notes\n```', '3.1.0'), /found 0/);
  for (const heading of ['3.1.0', '[3.1.0] - 2026-10-12', '3.1.0 — 2026-10-12']) {
    assert.doesNotThrow(() => validateReleaseVersion({ ...data, release: true, changelog: `## ${heading}\n\n- Actual release notes` }));
  }
});
