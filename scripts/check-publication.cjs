const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const markdown = require('markdown-it')();

const publicDocs = new Set([
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'DEVELOPMENT.md',
  'SECURITY.md',
  'docs/SOURCE_COVERAGE.md',
  'examples/README.md',
]);
const allowedDocs = new Set([
  'docs/SOURCE_COVERAGE.md',
  'docs/rich-markdown-preview-light.png',
  'docs/rich-markdown-preview-dark.png',
]);
const privateRoot =
  /^(?:\.local-docs|specs|research|audits|plans|notes|backups|secrets|\.codex|\.claude|\.agents|\.agent|\.cursor|\.aws|\.azure|\.ssh|\.gnupg)(?:\/|$)/i;
const secretName =
  /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.env|\.envrc|\.netrc|_netrc|\.pypirc|\.git-credentials|credentials(?:\.[^/]*)?\.json|service-account[^/]*\.json|[^/]*-credentials\.json|id_(?:rsa|ed25519)(?:\..*)?)$|\.(?:pem|key|p12|pfx|jks|keystore|mobileprovision|bundle)$/i;
const privateDocument =
  /(?:^|\/)(?:specs?|research|audits?|implementation)\/(?!$)|(?:^|\/)(?:spec-\d+[^/]*|user-input-required)\.(?:md|json|html)$/i;
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[\w-]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{15,}/],
  ['OpenAI token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
];

function violationsFor(entries, ignored = new Set()) {
  const files = new Set(entries.map((entry) => entry.path));
  const failures = [];
  for (const entry of entries) {
    const file = entry.path;
    if (
      ignored.has(file) ||
      privateRoot.test(file) ||
      secretName.test(file) ||
      privateDocument.test(file) ||
      (file.startsWith('docs/') && !allowedDocs.has(file)) ||
      (file.startsWith('.vscode/') && !['.vscode/launch.json', '.vscode/tasks.json'].includes(file)) ||
      ['assets/logo-source.png', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(file)
    )
      failures.push(`${file}: forbidden publication path`);
    const buffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    for (const [label, signature] of signatures) {
      const match = signature.exec(text);
      if (match)
        failures.push(`${file}:${text.slice(0, match.index).split('\n').length}: possible ${label} (value redacted)`);
    }
    if (!publicDocs.has(file)) continue;
    // Parse actual links, including reference links; ignore inline/fenced examples.
    const links = [];
    const visit = (tokens) => {
      for (const token of tokens) {
        if (token.type === 'link_open') links.push(token.attrGet('href'));
        if (token.type === 'image') links.push(token.attrGet('src'));
        if (token.children) visit(token.children);
      }
    };
    visit(markdown.parse(text, {}));
    for (const href of links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
      const raw = href.split(/[?#]/)[0];
      let target;
      try {
        target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(raw)));
      } catch {
        failures.push(`${file}: invalid encoded document link`);
        continue;
      }
      if (
        target.startsWith('../') ||
        target.startsWith('/') ||
        (!files.has(target) && ![...files].some((candidate) => candidate.startsWith(target.replace(/\/$/, '') + '/')))
      )
        failures.push(`${file}: broken or private local link to ${target}`);
    }
  }
  return failures;
}

function readIndex(root) {
  const output = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root }).toString('utf8');
  const inventory = output
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [, oid, stage, file] = /^\d+ ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(line) || [];
      if (!file || stage !== '0') throw Error('Resolve index conflicts before checking publication');
      return { path: file, oid };
    });
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: inventory.map((entry) => entry.oid).join('\n') + '\n',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw Error('Could not read indexed file contents');
  let offset = 0;
  return inventory.map((entry) => {
    const end = result.stdout.indexOf(10, offset);
    const [, type, length] = result.stdout.subarray(offset, end).toString('utf8').split(' ');
    if (type !== 'blob') throw Error('Only ordinary project files may be published');
    const data = result.stdout.subarray(end + 1, end + 1 + Number(length));
    offset = end + Number(length) + 2;
    return { ...entry, data };
  });
}

function check(root = path.resolve(__dirname, '..')) {
  const entries = readIndex(root);
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: root,
    input: Buffer.from(entries.map((entry) => entry.path).join('\0') + '\0'),
  });
  if (![0, 1].includes(result.status)) throw Error('Could not evaluate publication ignore policy');
  const ignored = new Set(result.stdout.toString('utf8').split('\0').filter(Boolean));
  const failures = violationsFor(entries, ignored);
  if (failures.length) throw Error(failures.join('\n'));
  return entries.length;
}

if (require.main === module) {
  try {
    console.log(`Publication policy passed for ${check()} indexed files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { check, violationsFor };
