# medplum-coverage-harness

A closed-loop test coverage harness for `medplum/packages/app`. Discovers
surfaces, scores existing tests against a `(Surface, Precondition, Behavior)`
vocabulary, then drives an agent to close gaps — single-shot or autonomously.

> Design lives in [docs/design.md](./docs/design.md). The doc is the source of
> truth; this README is the quickstart.

## Requirements

- Node 20+ (`.nvmrc` pins it)
- A sibling checkout of `medplum/` (default: `../medplum`)
- `claude` CLI on `PATH` (only required for `close` / `loop`)

## Quickstart

```bash
nvm use            # node 20
npm install
npm run build

# Point harness at your medplum checkout (writes harness.config.json)
./bin/run.js init --target ../medplum

# Single-shot scan: build manifest, score it, write a scan report
./bin/run.js scan

# Single-shot close: pick a gap, run the agent, optionally verify with Jest
./bin/run.js close --gap <unit-id> --verify

# Autonomous loop with goal + guardrails
./bin/run.js loop --until p0-gaps==0 --verify
```

## What's deliberately not implemented

- Retry-with-feedback per gap (one-shot today; design doc §11.5)
- Mutation-testing oracle (catches `expect(true).toBe(true)`; design doc §11.3)
- Playwright matcher under `packages/e2e/` (design doc §11.6)

## Continuous integration

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — every push and PR. `npm ci` + `npm run build` + `npm test`.
- **`coverage-scan.yml`** — every PR + daily cron. Clones medplum, runs the
  full scan against it, surfaces the report in the run summary, uploads it as
  an artifact, and posts the headline section as a PR comment so coverage
  deltas show up in code review without anyone running the harness locally.

## Layout

```
src/
  schema/manifest.ts          Zod schemas + cross-ref validation
  discover/                    Route/test discovery (ts-morph), mock-catalog
  score/                       Test-file matcher + status rank merge
  close/                       Pick → prompt → agent → verify
  loop/                        Autonomous controller with guardrails
  report/                      Scan report + loop report renderers
  commands/                    oclif command definitions
prompts/
  close-gap.md                 Agent prompt template
  mock-setups.md               Hand-curated MockClient setup snippets
  behavior-assertions.md       Behavior assertion guidance
tests/
  schema.test.ts               Manifest parse + cross-ref validation
  stopping-conditions.test.ts  Guardrail evaluation
  mock-catalog.test.ts         Precondition discovery + auto-synthesis
  loop-report.test.ts          Loop report rendering
  … (9 test files total, ~130 tests)
```

## Generated artifacts

`coverage.manifest.yaml` is written by `harness scan` and gitignored. Commit
it only when you want to snapshot a coverage baseline for a specific medplum
commit — do so explicitly (`git add -f coverage.manifest.yaml`) with a commit
message that names the medplum SHA. CI runs `harness scan` from scratch each
time and does not rely on a checked-in manifest.
