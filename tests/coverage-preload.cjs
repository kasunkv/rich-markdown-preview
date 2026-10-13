// Explicitly shared with VM contexts in the host mocks. Each test process writes its own counters.
const fs = require('node:fs');
const path = require('node:path');
globalThis.__coverage__ ??= {};
process.on('exit', () => {
  if (!process.env.SOURCE_COVERAGE_DIR) return;
  fs.mkdirSync(process.env.SOURCE_COVERAGE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.SOURCE_COVERAGE_DIR, `host-${process.pid}.json`),
    JSON.stringify(globalThis.__coverage__),
  );
});
