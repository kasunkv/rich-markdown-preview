# Source coverage policy

`npm run test:coverage` runs production packaging checks, instruments first-party TypeScript before bundling, runs the Node behavior suites and deterministic Chromium suites, and enforces `coverage-baseline.json`. Production bundles are restored afterward. `test:coverage:only` performs the same complete collection; it never accepts an old report.

Every executable `src/**/*.ts` module is included, recursively, even if no suite imports it. Declaration-only files (including `.d.ts`) are excluded. Dependencies, generated bundles, test harnesses, CSS, and static schemas are outside this TypeScript denominator. CSS still receives the existing theme/contrast and browser behavior checks. There are no application-module exclusions.

Coverage uses one Istanbul counter format for both environments. Counters are inserted into original TypeScript, with original statement/function/branch locations, before esbuild strips types and bundles. Inline instrumentation maps are composed into development bundle maps. The VM host mocks explicitly share `globalThis.__coverage__`; worker preloads write independent process contributions on exit. The browser fixture collects page counters, preserving them in sessionStorage across reloads. Browser-server Node execution is a host contribution. The current host measurement is from mocked Node/VM behavior tests, not a claim of real VS Code extension-host coverage. Spec005 real-host tests remain a separate gate.

Each fresh `.test-results/coverage/<timestamp>-<uuid>/` contains the zero-counter inventory, raw `host/` and `browser/` counters, original-source bundle maps, command logs, `contributions.json`, `summary.json`, `coverage-final.json`, `coverage-summary.json`, `lcov.info`, HTML `index.html`, and commit-tagged `run.json`. Only counters whose source location maps match the current inventory can merge. Missing contributions, unknown/vendor files, failed tests, and map mismatches fail the command. HTML/LCOV use original TypeScript locations directly; they never use bundled line percentages.

The ratchet compares lines, statements, functions, and branches per module with the reviewed baseline. Lower percentages, missing/new modules, or shrinking executable denominators fail. `npm run test:coverage:baseline` performs the complete current run and writes a candidate baseline; review its diff before committing. It is an explicit maintenance command, never part of CI. Raising the baseline after improved tests is encouraged. Intentional code deletion requires reviewing the reduced denominator rather than silently dropping uncovered code. Spec030 activates the final 95/95/95/90 thresholds; this baseline does not yet enforce those final targets.

Changed code must include focused behavior assertions and keep every affected module at or above its baseline. New modules require behavior tests and a reviewed baseline entry; their complete source remains in the denominator. For privileged messages, URI/resource policy, trust, clipboard/export, stale/disposed sessions, and error handling, tests must assert the permitted result and the denied/failure result (including absence of privileged side effects). A percentage alone is insufficient evidence. Existing settings, documentation, renderer, reference, and table regressions remain mandatory. Reviewers should examine changed lines and uncovered branches in HTML, and run the focused behavior suite along with the complete ratchet.

`coverage-exceptions.json` is an array. An exception must name one exact module and metric, a numeric minimum percentage, an owner, tracked issue, specific technical reason, and ISO expiry date within 90 days. Invalid or expired exceptions fail; no exceptions are currently active. Exceptions can temporarily lower one percentage floor, but cannot hide a module, remove its denominator, or omit safety behavior tests. Example:

```json
[
  {
    "module": "preview.ts",
    "metric": "branches",
    "minimum": 79,
    "owner": "maintainer",
    "issue": "repository issue URL",
    "reason": "Specific technically unreachable browser condition, with evidence",
    "expires": "2026-11-12"
  }
]
```

The coverage fixtures prove an unimported executable module is reported at zero, declaration-only files are excluded, VM counters and bundle maps point at original TypeScript lines, incompatible/vendor counters fail, expired exceptions fail, and a deliberately regressed summary causes the coverage-check CLI to exit with status 1.
