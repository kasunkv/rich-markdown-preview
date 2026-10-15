const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { violationsFor } = require('../scripts/check-publication.cjs');
const entry = (path, data = '') => ({ path, data });

test('publication policy rejects forced private files and unapproved public docs', () => {
  for (const file of [
    '.local-docs/audit.md',
    'docs/implementation/spec-032.md',
    'docs/new-notes.md',
    'specs/plan.md',
    '.env.local',
    'secrets/publisher.txt',
    'nested/private.key',
    '.vscode/settings.json',
    'assets/logo-source.png',
    'elsewhere/spec-099.md',
  ]) {
    assert.ok(
      violationsFor([entry(file)]).some((failure) => failure.includes('forbidden publication path')),
      file,
    );
  }
  assert.ok(violationsFor([entry('incidental.txt')], new Set(['incidental.txt'])).length);
  assert.deepEqual(
    violationsFor([
      entry('src/extension.ts'),
      entry('docs/SOURCE_COVERAGE.md'),
      entry('.vscode/launch.json'),
      entry('tests/fixtures/workspace/.claude/nested/guide.md'),
    ]),
    [],
  );
});

test('public guide links must resolve to published files, including encoded paths', () => {
  assert.deepEqual(
    violationsFor([
      entry(
        'README.md',
        '[Guide](DEVELOPMENT.md#setup) ![image](docs/rich-markdown-preview-light.png) [Example](examples/URI%20space.md)',
      ),
      entry('DEVELOPMENT.md'),
      entry('docs/rich-markdown-preview-light.png'),
      entry('examples/URI space.md'),
    ]),
    [],
  );
  for (const link of ['missing.md', '.local-docs/plan.md', 'docs/implementation/spec-032.md', '../outside.md'])
    assert.ok(violationsFor([entry('README.md', `[Guide](${link})`)]).length, link);
  assert.deepEqual(
    violationsFor([entry('README.md', '[External](https://example.com) [Contact](mailto:maintainer@example.com)')]),
    [],
  );
});

test('secret-signature failures identify location without printing the value', () => {
  const credential = 'gh' + 'p_' + 'A'.repeat(36);
  const failures = violationsFor([entry('src/fixture.ts', '\nconst token = "' + credential + '";')]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /src\/fixture.ts:2: possible GitHub token/);
  assert.ok(!failures[0].includes(credential));
});

test('link checks follow reference definitions and ignore Markdown syntax shown as code', () => {
  assert.deepEqual(violationsFor([entry('README.md', '`[Demo](missing.md)`\n\n```md\n[Demo](missing.md)\n```')]), []);
  assert.ok(violationsFor([entry('README.md', '[Guide][guide]\n\n[guide]: missing.md')]).length);
});

test('CI artifact uploads exclude raw profiles, traces and diagnostic directories', () => {
  const directory = path.resolve(__dirname, '../.github/workflows');
  const allowed = new Set([
    '*.vsix',
    '.test-results/release/candidate/',
    '.test-results/release/tools/',
    'receipt/marketplace.json',
  ]);
  for (const filename of fs.readdirSync(directory).filter((file) => file.endsWith('.yml'))) {
    const workflow = YAML.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps || []) {
        if (step.uses?.startsWith('actions/upload-artifact@'))
          assert.ok(allowed.has(step.with.path), `${filename}: unreviewed artifact path`);
      }
    }
  }
});
