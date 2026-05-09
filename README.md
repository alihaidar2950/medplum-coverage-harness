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

## What's implemented today

- Manifest schema + cross-reference validation (Zod)
- Loop safety: stopping conditions, budget tracker, iteration logger (full)
- CLI skeleton (oclif) for `init`, `scan`, `close`, `loop`
- Working `child_process.spawn` boilerplate for the agent and Jest verify
- `tests/schema.test.ts` and `tests/stopping-conditions.test.ts` (Vitest)

## What's stubbed

- ts-morph route/component discovery
- Test parsing + unit matching + regression detection
- Prompt building, close orchestration, report rendering

See `TODO` markers in `src/discover/`, `src/score/`, `src/close/`, `src/report/`.

## Layout

```
src/
  schema/manifest.ts          Zod schemas + cross-ref validation
  loop/                        Autonomous controller (stopping logic = real)
  close/                       Pick → prompt → agent → verify (spawn = real)
  discover/, score/, report/   Stubs with TODO markers
prompts/
  close-gap.md                 Agent prompt template
  mock-setups.md               Precondition snippets (5 stubs)
  behavior-assertions.md       Behavior assertion guidance
tests/
  schema.test.ts
  stopping-conditions.test.ts
```
