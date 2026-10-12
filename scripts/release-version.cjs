const MarkdownIt = require('markdown-it');

// SemVer 2.0.0: numeric core/prerelease identifiers cannot have leading zeroes.
const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

function validateVersion(version, label = 'package.json version') {
  if (typeof version !== 'string' || !semver.test(version) || version.includes('\n')) {
    throw new Error(`${label} must be valid SemVer; got ${JSON.stringify(version)}`);
  }
}

function validateReleaseNotes(changelog, version, label = 'CHANGELOG.md') {
  const tokens = new MarkdownIt({ html: true }).parse(changelog, {});
  const sections = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open' || tokens[i].tag !== 'h2') continue;
    const heading = tokens[i + 1].content;
    const match = heading.match(/^(?:\[([^\]]+)\]|(\S+))(?:\s+[—-]\s+.*)?$/);
    sections.push({ version: match?.[1] || match?.[2], start: i });
  }
  const matches = sections.filter(section => section.version === version);
  if (matches.length !== 1) throw new Error(`${label}: expected one release notes entry for ${version}; found ${matches.length}`);
  const start = matches[0].start;
  const end = sections.find(section => section.start > start)?.start ?? tokens.length;
  const hasNotes = tokens.slice(start + 3, end).some((token, index) =>
    tokens[start + 2 + index].type !== 'heading_open' &&
    ['inline', 'fence', 'code_block'].includes(token.type) && token.content.trim());
  if (!hasNotes) throw new Error(`${label}: release notes entry for ${version} is empty`);
}

function validateReleaseVersion({ manifest, lock, release = false, changelog, tag }) {
  validateVersion(manifest.version);
  for (const [label, actual] of [
    ['package-lock.json version', lock.version],
    ['package-lock.json packages[""] version', lock.packages?.['']?.version],
  ]) {
    if (actual !== manifest.version) throw new Error(`${label} mismatch: expected ${manifest.version}; got ${JSON.stringify(actual)}`);
  }
  if (tag !== undefined && tag !== `v${manifest.version}`) {
    throw new Error(`Release tag mismatch: expected v${manifest.version}; got ${JSON.stringify(tag)}`);
  }
  if (release) validateReleaseNotes(changelog, manifest.version);
  return { version: manifest.version, release, ...(tag === undefined ? {} : { tag }) };
}

module.exports = { validateVersion, validateReleaseNotes, validateReleaseVersion };
