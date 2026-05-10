# Project Conventions — medplum-coverage-harness

This file is loaded into Claude Code's context for any session in this repo.
Read it before making non-trivial edits. It captures invariants that aren't
self-evident from the code.

## What this project is

A closed-loop test coverage harness for `medplum/packages/app`. It models
coverage in a custom vocabulary, identifies gaps, drives an agent to write a
test, re-scores, and reports the delta. Single-shot or autonomous (with
guardrails). Full design lives in [docs/design.md](docs/design.md) — that
document is the source of truth; if anything here drifts, update both.

## The "loop is the point"

The interview brief is explicit: a coverage report nobody acts on, or a test
generator with no model behind it, both miss what's being evaluated. Every
design decision should reinforce: **scan → close → re-scan → delta** is the
unit of value, not any one of those steps in isolation.

## Vocabulary (do not change without updating the design doc)

A coverage unit is `(Surface, Precondition, Behavior)`:

- **Surface** — a route + page component in `packages/app/src/`.
- **Precondition** — a `MockClient` setup. **First-class**, not a fixture
  detail; the brief explicitly elevated MockClient.
- **Behavior** — fixed enum of 10 verbs. 7 generic UI verbs + 3 healthcare-
  specific (`phi-masked`, `audit-event-emitted`, `consent-honored`).

Status enum: `COVERED | PARTIAL | GAP | REGRESSION | IGNORED`.

## Stack

- TypeScript strict, Node 20+, ESM.
- **CLI:** oclif v4. Do not swap to commander/yargs.
- **Static analysis:** ts-morph.
- **Schemas:** Zod, with parse-time cross-reference validation.
- **Manifest format:** YAML (eemeli/yaml package). Humans review/edit
  `IGNORED` notes; YAML is more reviewable than JSON for that.
- **Internal tests:** Vitest. Jest is the runner the harness *invokes*, not
  what it uses internally — do not confuse the two.
- **Agent:** `child_process.spawn('claude', ['--print', ...])`.

## Invariants (the file-level rules)

1. **Schema cross-references must validate at parse time.** Every
   `unit.surface`, `unit.precondition`, `unit.behavior` must resolve.
   `parseManifest` enforces this; do not bypass it. (See
   `src/schema/manifest.ts`.)

2. **Prompt references must validate at scan/close time.** Every
   `precondition.mock_setup_ref` and `behavior.assertion_ref` must point to a
   real `## <id>` section with a fenced code block in the referenced markdown
   file. `validatePromptReferences` enforces this. (See `src/schema/refs.ts`.)
   The reason is non-obvious: a typo silently produces a prompt with literal
   "// TODO: snippet missing" text sent to the agent.

3. **Status rank merge: `COVERED > PARTIAL > GAP`.** Score never downgrades.
   When multiple tests match the same unit, the strongest signal wins.

4. **Honest > generous matcher.** PARTIAL is not a failure — it's how we
   express "filename matches but mock setup is unknown." Do not promote
   PARTIAL → COVERED to make numbers look better.

5. **The headline metric is delta, not absolute coverage %.** §11.2 of the
   design doc explains: systematic matcher errors cancel out across
   before/after. Resist any code path that promotes "% covered" as the
   primary KPI.

6. **Loop guardrails are always-on.** `--iterations`, `--budget`,
   `--max-failures` cannot be disabled, only tuned. Quality-decay detection
   activates when `--verify` is on. Modifying `evaluateStoppingConditions` to
   skip a guardrail is never the right fix.

## What "working" means

After any change:

1. `npm run build` is clean.
2. `npm test` is green (currently 101 tests across 6 files).
3. If you touched the manifest catalog (preconditions, behaviors, surfaces),
   `./bin/run.js scan` succeeds against `../medplum`.

If a test fails because of an intentional behavior change, **update the test
to match** with a comment explaining why. Don't suppress.

## Discover ↔ Score ↔ Close ↔ Loop layering

```
util/    →   schema/   →   discover/   →   score/   →   close/   →   loop/
                                ↑              ↑           ↑          ↑
                          report/scan-report  report/close-report  iteration-logger
```

Modules below the line cannot import from modules above the line. If you find
yourself wanting to break this (e.g. schema importing from close), extract
the shared piece into `util/`. The `readSection` move into `util/markdown.ts`
is the canonical example.

## When invoking the agent

The harness ships an overlay at `agent-context/.claude/` that gets passed to
`claude --print` via `--add-dir`. It contains:

- A constrained `settings.json` allowing only the `Write` tool.
- A `pre-write-fence.sh` hook that rejects writes to any path other than
  `EXPECTED_TEST_FILE` (set by `agent-invoker.ts`).
- A `medplum-test-writing` skill with MockClient and render-utility patterns.
- A `CLAUDE.md` describing what the agent's job is.

This is the "constrain the agent at the tool layer" pillar — don't rely on
prompt instructions alone to keep the agent within bounds.

## What's deliberately not here

- No retry-with-feedback per gap. Single-shot today; design doc §11.5 covers
  it as a follow-on.
- No mutation-testing oracle. §11.3.
- No Playwright matcher. §11.6.
- No CI integration beyond `.github/workflows/coverage-scan.yml` posting a
  comment.

If you're tempted to add one of these, write the suggestion in the chat
first; don't expand scope silently.
