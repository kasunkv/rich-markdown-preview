// This file is embedded verbatim in the protected workflow; no checkout or
// downloaded executable script is needed in a job holding release authority.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const hash = (data) => createHash('sha256').update(data).digest('hex');
const need = (ok, message) => {
  if (!ok) throw Error(message);
};
const digest = (value) => /^[a-f0-9]{64}$/.test(value || '');
function file(directory, name) {
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), 'Unsafe artifact filename');
  const result = path.join(directory, name);
  need(fs.lstatSync(result).isFile(), 'Artifact is not a regular file');
  return result;
}
function verify(directory, expected) {
  need(
    digest(expected.digest) &&
      digest(expected.provenanceDigest) &&
      /^[a-f0-9]{40}$/.test(expected.commit || '') &&
      /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(expected.tag || ''),
    'Missing independent binding',
  );
  const bytes = fs.readFileSync(file(directory, 'provenance.json'));
  need(hash(bytes) === expected.provenanceDigest, 'Provenance digest mismatch');
  const p = JSON.parse(bytes);
  need(
    p.schema === 1 &&
      p.commit === expected.commit &&
      p.tag === expected.tag &&
      `v${p.version}` === expected.tag &&
      p.repository === 'kasunkv/rich-markdown-preview' &&
      p.branch === 'main' &&
      p.publisher === 'kasunkodagoda' &&
      p.name === 'rich-markdown-preview' &&
      p.vsix?.sha256 === expected.digest &&
      p.vsix.name === 'candidate.vsix',
    'Candidate identity mismatch',
  );
  need(Array.isArray(p.files) && new Set(p.files.map((f) => f.name)).size === p.files.length, 'Duplicate inventory');
  need(
    JSON.stringify(fs.readdirSync(directory).sort()) ===
      JSON.stringify(['provenance.json', ...p.files.map((f) => f.name)].sort()),
    'Candidate file inventory mismatch',
  );
  for (const f of p.files) {
    const data = fs.readFileSync(file(directory, f.name));
    need(digest(f.sha256) && data.length === f.bytes && hash(data) === f.sha256, 'Candidate file hash mismatch');
  }
  for (const required of [
    'candidate.vsix',
    'gate-evidence.json',
    'vsix-inventory.json',
    'package-lock.json',
    'runtime-dependencies.json',
    'sbom.cdx.json',
    'toolchain.json',
  ])
    need(
      p.files.some((f) => f.name === required),
      'Missing candidate evidence',
    );
  need(hash(fs.readFileSync(file(directory, 'candidate.vsix'))) === expected.digest, 'VSIX digest mismatch');
  return p;
}
function verifyTools(directory, expected) {
  need(digest(expected), 'Missing independent toolchain binding');
  need(
    JSON.stringify(fs.readdirSync(directory).sort()) ===
      JSON.stringify(['binding.json', 'package-lock.json', 'package.json']),
    'Unexpected toolchain files',
  );
  const bytes = fs.readFileSync(file(directory, 'binding.json'));
  need(hash(bytes) === expected, 'Toolchain binding mismatch');
  const binding = JSON.parse(bytes);
  need(
    JSON.stringify(binding.map((f) => f.name).sort()) === JSON.stringify(['package-lock.json', 'package.json']),
    'Unexpected toolchain binding',
  );
  for (const f of binding)
    need(digest(f.sha256) && hash(fs.readFileSync(file(directory, f.name))) === f.sha256, 'Toolchain hash mismatch');
  const manifest = JSON.parse(fs.readFileSync(file(directory, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(file(directory, 'package-lock.json')));
  need(
    !manifest.scripts && lock.packages?.['node_modules/@vscode/vsce']?.version === '4.0.0',
    'Unapproved release toolchain',
  );
}
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Release service HTTP ${response.status}`);
  return response;
}
async function boundedBytes(response, limit) {
  need(Number.isSafeInteger(limit) && limit >= 0 && limit <= 32 * 1024 * 1024, 'Invalid response byte limit');
  const declared = response.headers?.get('content-length');
  const encoding = response.headers?.get('content-encoding');
  const reader = response.body?.getReader();
  need(reader, 'Release response has no readable body');
  const chunks = [];
  let size = 0;
  try {
    // fetch decodes compressed bodies; bound their decoded stream rather than encoded Content-Length.
    if (declared != null && (!encoding || encoding === 'identity'))
      need(/^\d+$/.test(declared) && Number(declared) <= limit, 'Release response byte limit exceeded');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      need(size <= limit, 'Release response byte limit exceeded');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
async function inspect(p, directory) {
  const query = await request('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { Accept: 'application/json;api-version=3.0-preview.1', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: [{ pageNumber: 1, pageSize: 1, criteria: [{ filterType: 7, value: `${p.publisher}.${p.name}` }] }],
      flags: 1,
      assetTypes: [],
    }),
  });
  const extensions = (await query.json()).results?.[0]?.extensions;
  need(Array.isArray(extensions), 'Invalid Marketplace metadata');
  const extension = extensions.find((e) => e.publisher?.publisherName === p.publisher && e.extensionName === p.name);
  if (!extension?.versions?.some((v) => v.version === p.version && !v.targetPlatform)) return null;
  const response = await request(
    `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${p.publisher}/vsextensions/${p.name}/${p.version}/vspackage`,
  );
  const bytes = await boundedBytes(response, p.files.find((f) => f.name === p.vsix.name)?.bytes);
  need(
    bytes.length <= 32 * 1024 * 1024 && hash(bytes) === p.vsix.sha256,
    'Distributed artifact differs from tested VSIX',
  );
  fs.writeFileSync(path.join(directory, 'distributed.vsix'), bytes);
  // Identical downloaded bytes have already been installed in all matrix hosts;
  // no extension code is installed/executed while publisher authority is held.
  return {
    publisher: p.publisher,
    name: p.name,
    version: p.version,
    sha256: hash(bytes),
    installable: true,
    installability: 'same bytes installed by the required compatibility matrix',
  };
}
async function reconcile(
  p,
  directory,
  { inspectRemote = inspect, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 6 } = {},
) {
  need(Number.isInteger(attempts) && attempts >= 1 && attempts <= 6, 'Invalid distribution retry bound');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const remote = await inspectRemote(p, directory);
      if (remote) return remote;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await wait(10000);
  }
  throw Error('Distribution unconfirmed; reconcile retained artifact before another upload', { cause: lastError });
}
async function publish(
  p,
  candidate,
  tools,
  receipt,
  { inspectRemote = inspect, reconcileRemote = reconcile, upload } = {},
) {
  need(
    p.rehearsal === false &&
      process.env.RELEASE_MODE === 'publish' &&
      process.env.GITHUB_REF === `refs/tags/${p.tag}` &&
      process.env.GITHUB_REF_PROTECTED === 'true' &&
      process.env.GITHUB_REPOSITORY === p.repository,
    'Publication context is not approved',
  );
  need(!process.env.VSCE_PAT && !process.env.AZURE_CLIENT_SECRET, 'PAT/secret fallback is forbidden');
  fs.mkdirSync(receipt, { recursive: true });
  let remote = await inspectRemote(p, receipt),
    status = 'reconciled';
  if (!remote) {
    upload ||= require(path.resolve(tools, 'node_modules/@vscode/vsce/out/publish.js')).publish;
    try {
      await upload({ packagePath: [path.resolve(candidate, 'candidate.vsix')], azureCredential: true });
      status = 'published';
    } catch (error) {
      status = 'reconciled-after-upload-error';
      try {
        remote = await reconcileRemote(p, receipt);
      } catch {
        throw Error('Upload outcome uncertain; no automatic second upload', { cause: error });
      }
    }
    remote ||= await reconcileRemote(p, receipt);
  }
  fs.writeFileSync(
    path.join(receipt, 'marketplace.json'),
    JSON.stringify({ status, commit: p.commit, tag: p.tag, ...remote }, null, 2),
  );
}
async function githubRelease(p, candidate) {
  need(p.rehearsal === false && process.env.GITHUB_REF === `refs/tags/${p.tag}`, 'Invalid GitHub release context');
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  need(process.env.GH_TOKEN, 'GitHub release token unavailable');
  const api = `https://api.github.com/repos/${p.repository}/releases`;
  let response = await fetch(`${api}/tags/${p.tag}`, { headers, signal: AbortSignal.timeout(30000) }),
    release;
  if (response.status === 404)
    release = await (
      await request(api, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: p.tag,
          target_commitish: p.commit,
          name: p.tag,
          body: `Validated immutable candidate SHA-256: ${p.vsix.sha256}\nCommit: ${p.commit}`,
        }),
      })
    ).json();
  else {
    need(response.ok, 'GitHub release lookup failed');
    release = await response.json();
    need(
      release.tag_name === p.tag && release.target_commitish === p.commit && !release.draft,
      'Existing release identity differs; reconcile manually',
    );
  }
  const checksum = `${p.vsix.sha256}  candidate.vsix\n`;
  for (const name of ['candidate.vsix', 'SHA256SUMS.txt', 'provenance.json']) {
    const data = name === 'SHA256SUMS.txt' ? Buffer.from(checksum) : fs.readFileSync(file(candidate, name));
    const existing = release.assets?.find((a) => a.name === name);
    if (existing) {
      const bytes = await boundedBytes(
        await request(`${api}/assets/${existing.id}`, { headers: { ...headers, Accept: 'application/octet-stream' } }),
        data.length,
      );
      need(hash(bytes) === hash(data), 'Existing GitHub release asset differs');
      continue;
    }
    await request(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: data,
    });
  }
}
async function main(mode) {
  const candidate = 'candidate',
    tools = 'release-tools';
  if (mode === 'tools') return verifyTools(tools, process.env.TOOLS_DIGEST);
  const p = verify(candidate, {
    digest: process.env.CANDIDATE_DIGEST,
    provenanceDigest: process.env.PROVENANCE_DIGEST,
    commit: process.env.CANDIDATE_COMMIT,
    tag: process.env.CANDIDATE_TAG,
  });
  if (mode === 'publish') return publish(p, candidate, tools, 'receipt');
  if (mode === 'github') return githubRelease(p, candidate);
  need(mode === 'verify', 'Unknown release runtime operation');
}
module.exports = { verify, verifyTools, inspect, reconcile, publish, githubRelease, main };
if (require.main === module || !require.main)
  main(process.env.RELEASE_OPERATION).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
