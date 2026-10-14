// Server-only baseline. Browser/Mermaid/paint timings must be collected separately.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {execFileSync} = require('node:child_process');
const {renderMarkdown} = require('../dist/render.cjs');
const {fixtures} = require('../tests/performance-fixtures.cjs');
const samples = 11;
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
const results = fixtures().map(fixture => {
  const times = [];
  let htmlUnits = 0;
  for(let i=0;i<samples;i++) {
    const start = performance.now();
    const result = renderMarkdown(fixture.source);
    times.push(performance.now()-start);
    htmlUnits = result.html.length;
  }
  return {name:fixture.name,rows:fixture.rows,sourceBytes:Buffer.byteLength(fixture.source),htmlUnits,samples,hostSynchronousMs:{median:percentile(times,.5),p95:percentile(times,.95)},coldFirstRenderMs:times[0]};
});
const report = {status:'bounded-server-only', measuredAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime:process.version,platform:process.platform,release:os.release(),arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryGiB:os.totalmem()/1024**3,notes:['Serial synchronous calls; first sample includes initial parser/highlighter setup.','11 samples: p95 is the maximum sample.','Server timing excludes extension IPC, DOM, table enhancement, Mermaid SVG and paint; not an end-to-end claim.','Oversized fixtures deliberately exercise current documented fallbacks; compare complete preserved historical baseline separately.'],results};
const destination = path.resolve(process.argv[2] ?? '.test-results/spec027-render-latest.json');
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
console.log(destination);
console.table(results.map(({name,hostSynchronousMs})=>({name,...hostSynchronousMs})));
