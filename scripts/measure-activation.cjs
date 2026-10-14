// Preparation benchmark: production VM/mock-host measurements, not VS Code host timings.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
if (process.argv.includes('--sample')) {
  (async () => {
    const {host} = require('../tests/documentation-host.cjs');
    let started = performance.now();
    const h = host();
    const coldActivation = performance.now() - started;
    if (!h.status.visible || h.runtimeLoads.length) throw Error('Startup unexpectedly loads renderer');
    started = performance.now();
    const warm = host();
    const warmActivation = performance.now() - started;
    if (!warm.status.visible || warm.runtimeLoads.length) throw Error('Warm startup unexpectedly loads renderer');
    const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/workspace/test.md'), 'utf8');
    h.files.set('/repo/README.md', fixture);
    started = performance.now();
    await h.openSingle();
    const firstPreview = performance.now() - started;
    started = performance.now();
    await h.panels[0].message({type: 'ready'});
    const laterPreview = performance.now() - started;
    h.panels[0].dispose();
    process.stdout.write(JSON.stringify({coldActivation, warmActivation, firstPreview, laterPreview}));
  })().catch(error => {console.error(error); process.exitCode = 1;});
} else {
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const child = spawnSync(process.execPath, [__filename, '--sample'], {cwd:root,encoding:'utf8'});
    if (child.status !== 0) throw Error(child.stderr || 'Benchmark sample failed');
    samples.push(JSON.parse(child.stdout));
  }
  const timings = Object.fromEntries(Object.keys(samples[0]).map(key => {
    const sorted = samples.map(sample => sample[key]).sort((a,b) => a-b);
    return [key, {medianMs: sorted[10], p95Ms: sorted[18]}];
  }));
  const bundles = Object.fromEntries(['extension.js','render.cjs','preview.js'].map(file => [file,fs.statSync(path.join(root,'dist',file)).size]));
  const result = {status:'preparation only', measuredAt:new Date().toISOString(), methodology:'20 fresh Node processes; cold/warm VM parse + mock activation excludes process startup and fixture-module loading; first preview includes lazy module load + host Markdown render; later preview repeats ready; no browser diagram/render timing or real VS Code UI timing', hardware:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),platform:process.platform,arch:process.arch,node:process.version}, fixtureBytes:fs.statSync(path.join(root,'tests/fixtures/workspace/test.md')).size,bundles,timings,samples};
  fs.mkdirSync(path.join(root,'.test-results'),{recursive:true});
  fs.writeFileSync(path.join(root,'.test-results','activation-preparation.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,samples:undefined},null,2));
}
