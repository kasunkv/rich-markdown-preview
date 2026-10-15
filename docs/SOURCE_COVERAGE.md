# Source coverage policy

`npm run test:coverage` builds and checks production packaging, instruments
first-party TypeScript, runs the Node/VM and Chromium behavior suites, and
enforces both the reviewed baseline and final coverage gates. Production bundles
are restored afterward. `test:coverage:only` also collects fresh evidence;
neither command accepts a previous report as proof of the current source.

## Inventory and thresholds

Every executable `src/**/*.ts` module is included, even when no suite imports it.
Declaration files, dependencies, generated bundles, harnesses and CSS are outside
this TypeScript inventory. CSS has separate theme/contrast and browser checks.

Lines, statements and functions require at least **95%** coverage; branches
require at least **90%**, globally, per module and for changed executable code.
The per-module `coverage-baseline.json` ratchet also prevents regression and
silent denominator shrinkage. New modules need behavior tests and a reviewed
baseline entry. `npm run test:coverage:baseline` collects a complete run and
creates a candidate baseline; review the diff rather than refreshing it in CI.

Set `COVERAGE_BASE` to the intended integration base; local checks default to
`HEAD^`. Coverage locations refer to original TypeScript. Node/VM counters and
browser counters share one instrumentation format, but neither establishes
actual Electron/VS Code host coverage. Real host compatibility is a separate gate.

## Safety and mutation requirements

Review `safety-policy.json` checksums and `safety-branches.json` locations when
changing source. Every reachable reviewed safety arm must execute. Tests for
messages, trust, resources, navigation, clipboard, export, stale sessions and
failures must assert permitted and denied outcomes, including the absence of
privileged side effects. A percentage alone is insufficient.

`safety-exceptions.json` permits only narrow, technically unreachable arms with
an owner, tracked issue, specific proof and expiry within 90 days. It cannot waive
the global/per-module/changed-code floors. `coverage-exceptions.json` has separate
reviewed baseline exception rules and cannot bypass the final gates.

`npm run test:mutation` runs focused mutations in disposable copies. A mutation
must compile and be killed by a behavior assertion. Do not lower the inherited
`mutation-baseline.json` requirement or replace assertion failures with setup
failures as evidence.

## Local diagnostics

Fresh results, original-source maps, HTML/LCOV, counters, command logs and
commit-tagged evidence are written under ignored `.test-results/`. Incompatible
maps, missing contributions, unknown/vendor files and failed suites fail the run.
Keep these diagnostic files local; they can contain absolute paths and fixture
content. The public repository contains maintained policies/baselines, not
run-specific evidence or implementation specifications.
