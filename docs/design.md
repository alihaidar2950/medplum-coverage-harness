# Medplum Coverage Harness — Design Doc

**Author:** Ali Haidar
**For:** Intrahealth / HEALWELL AI — SDET Senior take-home (Task 004)
**Status:** v3 (adds autonomous loop with stopping conditions, budget caps, quality gates)
**Document type:** HLD + targeted DD drill-downs

---

## 1. The North Star

A single CLI — `harness` — that, against a sibling checkout of `medplum/`, can:

```bash
# Single-shot: emit current coverage state and open gaps
harness scan

# Single-shot: pick a gap, drive an agent, re-score, report delta
harness close --gap <gap-id> [--verify]

# Autonomous: run the loop repeatedly until a stopping condition fires
harness loop \
  [--iterations N] \
  [--until <condition>] \
  [--strategy <picker>] \
  [--budget <minutes>] \
  [--max-failures N] \
  [--verify]
```

The harness supports **two modes**: single-shot (one iteration, predictable, demoable) and autonomous (runs until a goal is met or a guardrail fires).

---

## 2. What I'm Optimizing For (and What I'm Not)

The brief is explicit: **not** looking for hand-written tests, **not** looking for a passing suite. They're evaluating:

1. **The vocabulary I invent for "coverage"** — does it model the app, not the codebase?
2. **The decomposition** — do test cases map cleanly to executable units, and does the model stay synchronized as the app evolves?
3. **The orchestration** — am I directing an agent intelligently, or just shelling out to `jest --coverage`?
4. **The closed loop** — does the harness *act* on what it finds, and can it run unsupervised?

Things I'm explicitly **not** doing:
- Wiring up `jest --coverage` and calling line/branch percentage "the model"
- Trying to make every generated test pass on first try
- Setting up the Medplum backend; `MockClient` is the seam
- Running the autonomous loop unbounded — every autonomous run has hard guardrails (§5)

---

## 3. Coverage Model — the vocabulary

### 3.1 The unit of coverage

A coverage unit is a **`SurfaceState` tuple**:

```
SurfaceState = (Surface, Precondition, Behavior)
```

| Dimension | What it is | Examples |
|---|---|---|
| **Surface** | A page route or top-level component in `packages/app/src/` | `/Patient/:id`, `/admin/project`, `/signin`, `BotEditor` |
| **Precondition** | The `MockClient` seed state — auth state + FHIR resources present | `unauthenticated`, `practitioner-signed-in`, `practitioner-signed-in + 1 Patient + 2 Encounters` |
| **Behavior** | The user-observable outcome being asserted | `renders`, `list-displayed`, `form-submit-success`, `form-validation-error`, `navigates`, `empty-state`, `error-state` |

A unit is **`COVERED`** iff there exists at least one Jest or Playwright test that:
1. Exercises the matching `Surface`,
2. Sets up the matching `Precondition` via `MockClient` (or equivalent E2E fixture),
3. Asserts the matching `Behavior`.

A unit is **`PARTIAL`** when the matcher finds an ambiguous match. Honest > generous.

A unit is **`GAP`** when no test matches.

A unit is **`REGRESSION`** when it was `COVERED` in the previous manifest but is now `GAP`.

A unit is **`IGNORED`** when explicitly marked so with a `reason`. Excluded from gap counts.

### 3.2 How coverage is represented

A YAML manifest checked into the harness repo. (See §6 for the schema.)

### 3.3 Synchronization with the evolving app

- **Surfaces** discovered by parsing `AppRoutes.tsx` with ts-morph. New routes → new surfaces, automatically.
- **Preconditions** bootstrapped from (a) hand-curated seeds and (b) extraction of distinct `MockClient.*` setup patterns from existing test files
- **Behaviors** fixed enum (~7 verbs). Changes are deliberate doc-level decisions, not drift
- **Units** = Cartesian product, filtered by priority heuristic:
  - **P0** — sign-in, sign-up, OAuth, home page (anything blocking auth)
  - **P1** — `*Page.tsx` reachable from sidebar (clinical surfaces)
  - **P2** — secondary admin, error pages, debug routes
- **Scoring** matches existing tests via three signals: imported component, MockClient setup pattern, assertion style. Ambiguous → `PARTIAL`.

### 3.4 Regression detection

Every `scan` preserves the previous manifest as `coverage.manifest.previous.yaml` and diffs:

- Was `COVERED`, now `GAP` → flagged `REGRESSION`, surfaces in report header
- Was `GAP`, now `COVERED` → counted in `closed` total
- Didn't exist before → counted as `new units`
- Existed before but no longer → counted as `retired units`

Makes the harness useful in CI, not just one-shot demos.

---

## 4. Harness Architecture (HLD)

```
┌────────────────────────────────────────────────────────────────────┐
│                         harness CLI                                │
│                  (Node.js + TypeScript, oclif)                     │
└─────────┬──────────────────┬─────────────────┬─────────────────────┘
          │                  │                 │
          ▼                  ▼                 ▼
  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────┐
  │   discover/   │  │    score/     │  │      close/          │
  │               │  │               │  │                      │
  │ • route walk  │  │ • test parser │  │ • gap picker         │
  │ • component   │  │ • mock-call   │  │ • prompt builder     │
  │   discovery   │  │   extractor   │  │ • agent invoker      │
  │ • mock catalog│  │ • unit matcher│  │ • verify (Jest)      │
  │ • manifest    │  │ • regression  │  │ • re-score           │
  │   builder     │  │   detector    │  │ • delta reporter     │
  └───────┬───────┘  └───────┬───────┘  └─────────┬────────────┘
          │                  │                    │
          └──────────────────┼────────────────────┘
                             │
                             ▼
                 ┌─────────────────────────────┐
                 │       loop/                 │
                 │                             │
                 │ • iteration controller      │
                 │ • stopping condition eval   │
                 │ • budget enforcement        │
                 │ • failure tracking          │
                 │ • iteration log             │
                 └─────────────┬───────────────┘
                               ▼
                  ┌────────────────────────────┐
                  │ coverage.manifest.yaml     │
                  │ coverage.manifest.previous │
                  │ reports/*.md               │
                  │ reports/iteration-log.json │
                  └────────────────────────────┘
```

### 4.1 Modules

- **`discover/`** — produces the manifest from the target repo. Pure read-only static analysis.
- **`score/`** — scores units against existing tests; detects regressions.
- **`close/`** — the one-shot operation: pick → prompt → agent → verify → re-score → report.
- **`loop/`** — the controller for autonomous mode: orchestrates repeated calls to `close/`, evaluates stopping conditions, enforces budgets, tracks failures.

### 4.2 Why this shape

- **Discovery, scoring, closing, and looping are separate concerns.** A bug in the loop controller doesn't corrupt the matcher.
- **The agent never owns the model.** The harness owns it; the agent is a tool the harness uses.
- **Verify is optional and orthogonal.** A unit can be `COVERED` (matches) and still fail Jest (broken). Reported separately.
- **The loop is bounded by design.** No autonomous run is unbounded — every run has a hard cap (§5).

---

## 5. The Autonomous Loop (DD Drill-Down)

This is the section that distinguishes a one-shot demo from a real harness.

### 5.1 What an iteration does

```
for iteration in 1..N (or until stopped):
  1. scan (get current state, refresh manifest)
  2. evaluate stopping conditions; if any fired, STOP
  3. pick next gap via strategy
  4. close (prompt → agent → write test)
  5. if --verify: run Jest, capture result (do not block on failure)
  6. re-scan (compute delta)
  7. log iteration record
  8. update budget counters; if exceeded, STOP
```

### 5.2 Stopping conditions (`--until`)

The loop stops as soon as ANY of these conditions becomes true. Multiple can be supplied; they're OR'd.

| Condition | Meaning |
|---|---|
| `p0-gaps == 0` | All P0 gaps are now `COVERED`. Default goal for "make auth/critical paths safe." |
| `regressions == 0` | All regressions resolved. Use case: post-merge cleanup. |
| `coverage >= N%` | A simple absolute threshold. Gameable; use with caution. |
| `delta-stalled` | Three iterations in a row with zero net new closures. Loop is stuck. |
| `iterations >= N` | Hard iteration cap. Always present, default 10. |
| `budget-exceeded` | Wall-clock budget hit. Always present, default 30 minutes. |
| `failures >= N` | Consecutive agent failures hit. Always present, default 3. |

### 5.3 Budget enforcement (always on)

Every autonomous run has three guardrails that **cannot be disabled**, only tuned:

- **Iteration cap** (`--iterations`, default 10) — never run more than this many cycles
- **Wall-clock budget** (`--budget`, default 30 minutes) — never exceed this duration
- **Failure cap** (`--max-failures`, default 3) — bail after N consecutive agent failures

A "failure" is any of: agent timeout, agent produced no file, agent produced file at wrong path, produced test fails to even import.

These are guardrails, not goals. They exist so you can launch the harness, walk away, and not come back to a $50 Anthropic bill or 200 broken test files.

### 5.4 Gap picker strategies (`--strategy`)

| Strategy | Picks | Use case |
|---|---|---|
| `highest-priority` (default) | First `GAP` unit, sorted by priority then alphabetically | Generic "close important stuff first" |
| `regression-first` | Any unit with `REGRESSION` status; falls back to highest-priority | Post-merge cleanup |
| `fewest-deps` | The gap whose precondition setup is shortest (fewest fixture lines) | Easy wins, demoable |
| `random` | Uniform random over `GAP` set | Useful for breadth in long runs |

### 5.5 Quality gate via `--verify`

When `--verify` is on, every iteration runs Jest on the generated test file. The verify result is logged but **does NOT prevent the unit from being counted as `COVERED`** (the brief said tests don't need to pass, and we honor that).

However, the verify result **IS** used for two safety behaviors:

- If the test fails to compile (TypeScript error, missing import, malformed) → counts as a failure for `--max-failures` purposes
- If verify success rate drops below 50% over the last 5 iterations → automatic stop with reason `quality-decay`

This is how the harness avoids producing 50 broken tests in a row.

### 5.6 Iteration log

Every autonomous run writes `reports/iteration-log.json`:

```json
{
  "started_at": "2026-05-09T14:00:00Z",
  "config": {
    "iterations_max": 10,
    "until": ["p0-gaps == 0", "delta-stalled"],
    "strategy": "highest-priority",
    "budget_minutes": 30,
    "verify": true
  },
  "iterations": [
    {
      "n": 1,
      "started_at": "2026-05-09T14:00:01Z",
      "gap_picked": "unit.signin.unauthed.renders",
      "gap_priority": "P0",
      "agent_duration_ms": 47000,
      "agent_outcome": "success",
      "verify_outcome": "compile-ok-tests-pass",
      "delta": { "covered": +1, "partial": 0 }
    },
    {
      "n": 2,
      "started_at": "2026-05-09T14:01:30Z",
      "gap_picked": "unit.home.practitioner.renders",
      "gap_priority": "P0",
      "agent_duration_ms": 52000,
      "agent_outcome": "success",
      "verify_outcome": "compile-ok-tests-fail",
      "delta": { "covered": +1, "partial": 0 }
    }
  ],
  "stopped_at": "2026-05-09T14:08:00Z",
  "stopped_because": "p0-gaps == 0"
}
```

This file is the audit trail. It tells you what the harness did, why each gap was picked, how each iteration went, and why it stopped.

### 5.7 What the autonomous mode is and isn't

**It IS:** a controller that runs the closed loop until a goal or guardrail fires.

**It IS NOT:** an autonomous agent that "decides" what to test or rewrites the harness's own model. The harness's vocabulary (Surface, Precondition, Behavior catalogs) is human-curated. The loop just walks the existing manifest and closes one gap at a time.

This distinction matters. "Autonomous" here means "doesn't need a human to crank each cycle." It does NOT mean "self-directing" or "self-improving." Those are different (and harder, and riskier) properties that the brief doesn't ask for.

---

## 6. DD Drill-Down: Manifest Schema

Lives in `src/schema/manifest.ts` as a Zod schema. Every read and write goes through it.

```typescript
const SurfaceSchema = z.object({
  id: z.string().regex(/^surface\..+$/),
  route: z.string(),
  component: z.string(),
  discovered_via: z.string(),
});

const PreconditionSchema = z.object({
  id: z.string().regex(/^pre\..+$/),
  description: z.string(),
  auth: z.enum(['none', 'practitioner', 'admin']),
  resources: z.array(z.object({
    resourceType: z.string(),
    count: z.number().int().nonnegative(),
  })),
  mock_setup_ref: z.string(),
});

const BehaviorSchema = z.object({
  id: z.enum([
    // Generic UI verbs
    'beh.renders', 'beh.list-displayed', 'beh.form-submit-success',
    'beh.form-validation-error', 'beh.navigates', 'beh.empty-state', 'beh.error-state',
    // Healthcare-specific verbs — part of core vocabulary, not an extension axis
    'beh.phi-masked', 'beh.audit-event-emitted', 'beh.consent-honored',
  ]),
  description: z.string(),
  assertion_ref: z.string(),
});

const UnitSchema = z.object({
  id: z.string(),
  surface: z.string(),
  precondition: z.string(),
  behavior: z.string(),
  priority: z.enum(['P0', 'P1', 'P2']),
  status: z.enum(['COVERED', 'PARTIAL', 'GAP', 'REGRESSION', 'IGNORED']),
  covered_by: z.array(z.string()),
  notes: z.string().optional(),
}).refine(
  (u) => u.status !== 'IGNORED' || (u.notes && u.notes.length > 0),
  { message: 'IGNORED units must have notes with a reason' }
);
```

Cross-reference invariants enforced at load: `unit.surface` must match a `surfaces[].id`, etc.

---

## 7. DD Drill-Down: Agent Prompt Template

```text
You are writing ONE Jest test file to close a specific coverage gap.

# The gap
Surface:       {{surface.route}}  ({{surface.component}})
Precondition:  {{precondition.id}} — {{precondition.description}}
Behavior:      {{behavior.id}} — {{behavior.description}}

# Hard constraints
- Use @medplum/mock → MockClient for all FHIR state. No real API calls.
- Render via existing test utilities at packages/app/src/test-utils.tsx if present;
  otherwise use @medplum/react MedplumProvider directly.
- The test does not need to pass on first try. It DOES need to:
  1. Render {{surface.component}}
  2. Set up MockClient state matching {{precondition.id}}
  3. Make at least one assertion mapping to {{behavior.id}}
- File path: packages/app/src/{{surface.path}}/{{surface.name}}.{{behavior.id}}.test.tsx
- Do NOT modify any other file. Do NOT add new dependencies.

# MockClient setup snippet for this precondition
{{precondition.mock_setup_snippet}}

# Behavior assertion guidance
{{behavior.assertion_guidance}}

Output ONLY the test file contents, no commentary, no markdown fences.
```

Invocation: `claude --print --output-format text --allowedTools Write < prompt.txt > generated-test.tsx`

---

## 8. The CLI Contract

```bash
harness init --target <path>
# Validates <path>/packages/app/src exists; writes harness.config.json

harness scan
# discover() + score(), preserves previous manifest, writes new one
# Report header: gap counts by priority, regressions, new units, retired units
# Exits 0 success, 3 internal error

harness close [--gap <id>] [--strategy ...] [--verify]
# One iteration of the loop: pick → prompt → agent → verify → re-score → report
# Exits 0 success, 1 agent failed, 2 produced test didn't match gap, 3 internal error

harness loop \
  [--iterations N]            # default 10, hard max
  [--until <condition>...]    # OR'd; default: ["p0-gaps == 0", "delta-stalled"]
  [--strategy <picker>]       # default: highest-priority
  [--budget <minutes>]        # default 30, hard max
  [--max-failures N]          # default 3
  [--verify]                  # quality gate

# Runs autonomously until a stopping condition or guardrail fires
# Writes reports/loop-<timestamp>.md (summary)
# Writes reports/iteration-log.json (full audit trail)
# Exits 0 if stopped by --until condition, 4 if stopped by guardrail
```

---

## 9. The Closed Loop in Action

```
                  ┌──────────────────────────────────────┐
                  │  packages/app/src/  (target repo)    │
                  └──────────────┬───────────────────────┘
                                 │
                  ┌──────────────▼─────────────┐
            (1)   │   discover routes,         │
                  │   components, mock catalog │
                  └──────────────┬─────────────┘
                                 │
                  ┌──────────────▼─────────────┐
            (2)   │   score existing tests     │◀───────┐
                  │   detect regressions       │        │
                  └──────────────┬─────────────┘        │
                                 │                      │
                  ┌──────────────▼─────────────┐        │
                  │ check stopping conditions  │        │
                  │ if --until met: STOP       │        │
                  │ if guardrail hit: STOP     │        │
                  └──────────────┬─────────────┘        │
                                 │                      │
                  ┌──────────────▼─────────────┐        │
                  │ pick gap via strategy      │        │
                  └──────────────┬─────────────┘        │
                                 │                      │
                  ┌──────────────▼─────────────┐        │
            (3)   │   render prompt template   │        │
                  │   invoke `claude` headless │        │
                  │   → new test file          │        │
                  └──────────────┬─────────────┘        │
                                 │                      │
                            (optional)                  │
                                 │                      │
                  ┌──────────────▼─────────────┐        │
                  │ --verify: run Jest;        │        │
                  │ count compile failure as   │        │
                  │ a failure, but don't block │        │
                  │ unit from being COVERED    │        │
                  └──────────────┬─────────────┘        │
                                 │                      │
                  ┌──────────────▼─────────────┐        │
            (4)   │ log iteration, update      │        │
                  │ counters, compute delta    │────────┘
                  └────────────────────────────┘  (loop)
```

---

## 10. Execution Plan

| Block | Time | What | Tool |
|---|---|---|---|
| 0 | 15 min | Read brief, draft this design doc | Claude (chat) |
| 1 | 20 min | Scaffold harness repo: oclif CLI, Zod schemas, stubs | Claude Code |
| 2 | 25 min | Build `discover/` — walk AppRoutes, build seed manifest | Claude Code |
| 3 | 25 min | Build `score/` — parse tests, match to units, detect regressions | Claude Code |
| 4 | 20 min | Build `close/` — prompt + headless claude + verify + delta reporter | Claude Code |
| 5 | 15 min | Build `loop/` — controller, stopping conditions, budget enforcement | Claude Code |
| 6 | 15 min | Run `harness loop --until p0-gaps==0 --verify` end-to-end; capture | terminal |

**Drop priority if I overrun:** loop quality-decay detection → loop budget enforcement → loop stopping conditions (fall back to fixed iteration count) → verify support → regression detection. The single-shot `close --verify` running once is the floor.

---

## 11. Trade-offs and Limitations (the walkthrough self-critique)

### 11.1 Preconditions and behaviors are not from real requirements

In a production engagement, these would come from acceptance criteria, FHIR profiles, and risk-tier docs co-owned with clinicians and compliance. The behavior enum already includes the three load-bearing healthcare verbs — `phi-masked`, `audit-event-emitted`, `consent-honored` — but a real catalog would also have `clinically-valid` and finer-grained variants per FHIR profile.

For this take-home, the catalog is bootstrapped from (a) hand-curated seeds and (b) extraction of existing MockClient patterns. The shape doesn't change — still `(Surface, Precondition, Behavior)` — but the third axis would be co-owned, not invented by SDET. This shows I understand coverage-as-risk-model, not just coverage-as-completeness-metric.

### 11.2 The scoring heuristic is fragile

Static analysis can miss tests using unusual rendering wrappers or assertion styles. **Mitigation:** the headline metric is "gaps closed" (a delta), not "% covered" (an absolute). Systematic matcher errors cancel out across before/after.

### 11.3 Generated tests can be Goodhart'd

The agent could write `expect(true).toBe(true)` and the matcher would credit it. **Mitigation today:** human-in-the-loop review before merge; `--verify` catches non-compiling tests. **Mitigation longer-term:** mutation testing — run the test against a deliberately broken implementation; if it still passes, the assertion is fake.

### 11.4 Healthcare behaviors are present but lightly exercised

The enum includes `phi-masked`, `audit-event-emitted`, `consent-honored`, and `tests/healthcare-loop.test.ts` proves the close→re-scan cycle moves an `audit-event-emitted` unit GAP→COVERED end-to-end with a stubbed agent. What's missing is depth: each of these behaviors really wants its own assertion library (PHI redaction matchers, AuditEvent shape validators, Consent rule engine) so that generated tests can't be Goodhart'd by trivially matching the keyword without exercising the underlying compliance invariant.

### 11.5 Single-shot agent invocation, no retry-with-feedback

If `claude` produces malformed output, the iteration counts as a failure but doesn't retry the same gap with corrective feedback. Production would have retry-with-feedback: generate → validate → re-prompt with the validation error → up to N attempts per gap.

### 11.6 Jest-only generation; Playwright is a follow-on

Jest fails gracefully without a running app, MockClient is component-level, and most coverage gaps in `packages/app/src` are answerable at component level. **The vocabulary is runner-agnostic** — adding Playwright is: a parallel matcher walking `packages/e2e/`, a Playwright fixture variant of preconditions, and a second prompt template. Architecture doesn't change.

### 11.7 Autonomous loop's stopping conditions are coarse

Conditions like `coverage >= 50%` are vulnerable to gaming by adding low-quality units. The default `until: p0-gaps == 0` is more meaningful but still relies on the priority assignment being correct. A more sophisticated harness would weight units by historical bug-density, clinical risk, or change frequency. Today, priority is a 3-bucket heuristic (P0/P1/P2) — defensible but not adaptive.

### 11.9 `--verify` always reports `compile-failed` outside the medplum monorepo build

`harness close --verify` invokes `npx jest <file>` inside `medplum/packages/app/`.
The generated tests import from `@medplum/react`, `@medplum/mock`, and internal
test utilities like `./test-utils/render`. Resolving those imports requires the
full monorepo to have been built (`npm ci && npm run build` in the medplum root)
so that `node_modules` contains the workspace-linked packages.

When the harness is run against a freshly-cloned medplum repo without that build
step, every test will fail with `SyntaxError` or `Cannot find module`. The
`--verify` flag still produces accurate `compile-failed` outcomes, and the
guardrails fire correctly (consecutive failures → stop), but the verify signal
is structurally unusable until the target monorepo is fully built.

**Mitigation today:** skip `--verify` until `medplum/packages/app/node_modules`
is populated (`ls ../medplum/node_modules` is the quick check). The matcher
still scores generated tests as COVERED from filename + MockClient pattern, so
the delta is meaningful even without a passing Jest run.

**Mitigation longer-term:** add a `harness doctor` preflight that checks whether
the target repo's Jest environment is viable before any close/loop invocation
(§11.5 retry-with-feedback would also surface the stderr so the user can act).

### 11.8 Manifest could explode at scale

Today on `medplum/main`: 69 surfaces × 6 preconditions × 10 behaviors = 4,140 theoretical combinations. The category-driven behavior whitelist plus auth-aware precondition filtering trim that to **556 units** in practice. As the app grows, the whitelist itself would need automation or co-curation with developers as part of feature work — otherwise every new surface category requires a code change in `categorizeRoute`.

---

## 12. The Walkthrough — Slide Outline

10–12 minutes of content + 3–5 minutes Q&A inside the 15-minute window.

| Slide | Content | Speaker note |
|---|---|---|
| 1 | Problem & rubric | Quote: *"a coverage report nobody acts on, or a test generator with no model behind it, both miss what we're evaluating."* That's the rubric. My design avoids both. |
| 2 | Coverage vocabulary | The `(Surface, Precondition, Behavior)` decomposition. *"This is the most important slide."* |
| 3 | Why MockClient is an axis | The brief explicitly elevated it. Promoting it from fixture detail to a coverage dimension is how I respond to that signal. |
| 4 | Architecture | The four-module diagram from §4. Discovery, scoring, closing, looping. |
| 5 | Single-shot demo | Live or recorded `harness close --gap unit-X --verify`. Show the close report. |
| 6 | Autonomous demo | Live or recorded `harness loop --until p0-gaps==0 --verify`. Show the iteration log + final report. |
| 7 | Guardrails | Talk through §5.3 — every autonomous run is bounded. Iteration cap, budget cap, failure cap, quality decay detection. |
| 8 | The delta report | Show the actual file: before, generated test, after, verify result, what stopped the loop and why. |
| 9 | Limitations | Walk §11. Lead with: *"These are the questions I'd ask if I were grading this."* |
| 10 | What I'd do with another day | Healthcare-specific behaviors, retry-with-feedback per gap, mutation testing oracle, Playwright matcher, adaptive priority. |

The slide that wins this interview is slide 9. Most candidates won't volunteer their weaknesses; doing so signals seniority. Slide 6 (autonomous demo) is what proves the loop is real.

---

## 13. Repository Layout

```
medplum-coverage-harness/
├── README.md                  # Quickstart, runs the loop in 5 commands
├── docs/
│   ├── design.md              # This document — source of truth
│   ├── HOW_IT_WORKS.md        # Plain-English walkthrough of the codebase
│   ├── INPUTS_AND_OUTPUTS.md  # Hardcoded vs auto-discovered vs generated
│   ├── INTERVIEW_QA.md        # Likely head-of-engineering questions
│   ├── slides.md              # Marp deck for the walkthrough
│   └── demo-script.md         # Live demo timing + commands
├── package.json
├── tsconfig.json
├── harness.config.json        # Points at sibling medplum checkout
├── coverage.manifest.yaml     # Gitignored; regenerated each scan
├── coverage.manifest.previous.yaml
├── reports/                   # Gitignored; populated by runs
│   └── iteration-log.json     # Audit trail for autonomous runs
├── prompts/
│   ├── close-gap.md
│   ├── mock-setups.md
│   └── behavior-assertions.md
├── agent-context/.claude/     # Constrained overlay for `claude --print`
│   ├── settings.json          # Write-only allowlist
│   ├── hooks/pre-write-fence.sh
│   └── skills/medplum-test-writing/
└── src/
    ├── cli.ts
    ├── commands/
    ├── schema/manifest.ts
    ├── discover/
    ├── score/
    ├── close/
    ├── loop/                  # autonomous controller
    ├── report/
    └── util/
```
