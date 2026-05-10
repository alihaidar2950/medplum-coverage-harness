---
marp: true
theme: default
paginate: true
style: |
  section {
    font-family: 'Segoe UI', sans-serif;
    font-size: 28px;
    padding: 50px 60px;
  }
  h1 { color: #1a1a2e; font-size: 48px; margin-bottom: 10px; }
  h2 { color: #16213e; font-size: 38px; border-bottom: 3px solid #0f3460; padding-bottom: 8px; }
  h3 { color: #0f3460; font-size: 28px; }
  code { background: #f0f4f8; border-radius: 4px; padding: 2px 6px; font-size: 24px; }
  pre { background: #1a1a2e; color: #e8e8e8; border-radius: 8px; padding: 20px; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 22px; }
  th { background: #0f3460; color: white; padding: 10px; }
  td { padding: 8px 10px; border-bottom: 1px solid #ddd; }
  .highlight { color: #e94560; font-weight: bold; }
  .green { color: #2ecc71; font-weight: bold; }
  .yellow { color: #f39c12; font-weight: bold; }
  .small { font-size: 20px; color: #666; }
  section.title { text-align: center; display: flex; flex-direction: column; justify-content: center; }
  section.title h1 { font-size: 54px; }
---

<!-- _class: title -->

# Medplum Coverage Harness

### An autonomous closed-loop test coverage system for `medplum/packages/app`

**Ali Haidar** · SDET Senior Take-Home · Intrahealth / HEALWELL AI

---

## Slide 1 — The Brief, in One Sentence

> *"A coverage report nobody acts on, or a test generator with no model behind it, both miss what we're evaluating."*

The rubric has **four pillars**:

1. The **vocabulary** I invent for coverage — does it model the app, not the codebase?
2. The **decomposition** — do test cases map to executable units that stay in sync as the app evolves?
3. The **orchestration** — am I directing an agent intelligently, or just shelling out to `jest --coverage`?
4. The **closed loop** — does the harness *act* on what it finds, unsupervised?

This design hits all four. Let me show you how.

---

## Slide 2 — The Coverage Vocabulary

The atomic unit of coverage is a **triple**:

```
Unit = (Surface, Precondition, Behavior)
```

| Dimension | What it is | Example |
|-----------|-----------|---------|
| **Surface** | A page/route in the app | `/signin` → `SignInPage` |
| **Precondition** | MockClient state before the test | `pre.practitioner.with-patient` |
| **Behavior** | What the test asserts | `beh.form-validation-error` |

> This is the most important slide. The triple is **the model** — not line coverage, not file count.

A unit is `COVERED`, `PARTIAL`, `GAP`, `REGRESSION`, or `IGNORED`.
**Delta between scans** — not absolute % — is the headline metric.

---

## Slide 3 — Why MockClient Is a First-Class Axis

The brief **explicitly elevated** MockClient. This is the signal I responded to.

**Before (most approaches):** MockClient setup is a fixture detail, invisible to the coverage model.

**After (this harness):** MockClient state is a coverage dimension.

```
unit.patient-list.practitioner.with-patient.list-displayed  ← COVERED
unit.patient-list.practitioner.empty.empty-state            ← GAP ← harness knows to fill this
```

This matters because the same page behaves **completely differently** depending on what data is in MockClient. Treating setup as invisible leaves those cases silent.

**Auto-discovery:** The harness also walks existing test files, extracts MockClient patterns it hasn't seen before, and synthesizes new preconditions automatically. The catalog stays in sync as the app evolves.

---

## Slide 4 — Architecture

```
harness init   →   harness.config.json  (points at medplum/)
                         │
harness scan   →   discover()  +  score()  →  coverage.manifest.yaml
                         │                           │
                    AppRoutes.tsx            *.test.tsx files
                    (ts-morph AST)           (3-signal matcher)

harness close  →   pick gap  →  build prompt  →  spawn claude  →  verify  →  re-scan  →  delta
                                                       │
                                               agent-context/.claude/
                                               (Write-only, path-fenced)

harness loop   →   scan → stop? → close → log  ×N  →  loop report
```

Four separable modules. Each is independently testable.
**137 Vitest tests** across 10 files — every module is covered, including an end-to-end loop test that drives a healthcare-behavior gap GAP→COVERED with a stubbed agent.

---

## Slide 5 — Real Numbers (Live Scan Against `medplum/main`)

```
harness scan
```

| | Count |
|---|---|
| Surfaces discovered | **69** |
| Preconditions | **6** (5 seeds + 1 auto-discovered) |
| Behaviors | **10** |
| Total units | **556** |

| Priority | COVERED | PARTIAL | GAP |
|----------|---------|---------|-----|
| P0 (critical) | 2 | 0 | **40** |
| P1 (important) | 1 | 27 | **226** |
| P2 (nice-to-have) | 9 | 6 | **245** |

<span class="highlight">511 gaps identified</span> — 40 of them critical. This is the baseline `harness close` and `harness loop` work against.

---

## Slide 6 — Single-Shot Demo: `harness close`

```bash
harness close \
  --gap unit.signin.unauthed.form-validation-error \
  --verify
```

**What happens, step by step:**

1. Reads manifest — finds the unit (`/signin`, unauthenticated, validate bad input)
2. Builds a prompt filling in surface + precondition snippet + behavior guidance
3. Spawns `claude --print --allowedTools Write --add-dir agent-context/`
4. A **path fence hook** blocks Claude from writing anywhere except the expected file
5. File appears at `medplum/packages/app/src/SignInPage.beh.form-validation-error.test.tsx`
6. Runs `npx jest` on it — classifies: `compile-ok-tests-pass` / `compile-ok-tests-fail` / `compile-failed`
7. Re-scans — computes delta: `+1 COVERED`
8. Writes `reports/close-<timestamp>.md`

> **[DEMO or recording here]**

---

## Slide 7 — The Agent Is Constrained at the Tool Layer

The prompt alone is not enough. The constraint is **enforced at the OS level**.

```
agent-context/.claude/settings.json:
  allow: ["Write"]
  deny:  ["Bash", "Edit", "WebFetch", ...]

agent-context/.claude/hooks/pre-write-fence.sh:
  if file_path != $EXPECTED_TEST_FILE → exit 2 (rejected before write happens)
```

Claude **cannot** write to any other file. Not because the prompt says so — because the tool call is intercepted and rejected before it executes.

This is the "constrain the agent at the tool layer, not the prompt layer" principle.

---

## Slide 8 — Autonomous Demo: `harness loop`

```bash
harness loop --until delta-stalled --verify --iterations 10 --budget 30
```

**What happens:**

```
iteration 1: scan → 40 P0 gaps → close unit.signin.unauthed.renders → +1 covered
iteration 2: scan → 39 P0 gaps → close unit.oauth.unauthed.renders → +1 covered
iteration 3: scan → 38 P0 gaps → close unit.resetpassword... → agent fails
iteration 4: scan → 38 P0 gaps → close next → +1 covered
...
STOP: delta-stalled (3 consecutive iterations, zero new covered units)
```

Guardrails fire **before** user goals are checked:
- `iterations >= 10` → stop regardless
- `elapsed >= 30 min` → stop regardless
- `3 consecutive failures` → stop regardless
- `quality-decay` (< 50% of last 5 verified tests compile) → stop regardless

> **[Show `reports/loop-<timestamp>.md` here]**

---

## Slide 9 — Limitations (What I'd Ask If I Were Grading This)

*Leading with weaknesses signals seniority. This is the slide that wins the room.*

| Limitation | Why it exists | What I'd do next |
|------------|--------------|-----------------|
| **Filename-only surface match** | ts-morph can't trace `render(<SignInPage />)` back to a route without full compilation | Track import chains or use Playwright for route-level matching |
| **Heuristic behavior classification** | Keyword matching; "error" in a test name doesn't guarantee `beh.error-state` | Train a small classifier on test name → behavior; or require naming conventions |
| **No retry-with-feedback** | One-shot per gap today (§11.5 of design doc) | Feed Jest stderr back into the next prompt as context |
| **No mutation oracle** | A test that asserts `expect(true).toBe(true)` looks COVERED | Add mutation testing step (§11.3) to verify assertions actually catch failures |
| **No retry-with-feedback** | One-shot per gap today | Pipe Jest stderr back into the next prompt as additional context (§11.5) |

---

## Slide 10 — What I'd Do With Another Day

**Immediately valuable (low effort):**
- Add a `--dry-run` flag to `scan` that prints the manifest without writing it
- Surface the auto-discovered precondition count in the scan report header

**High value (medium effort):**
- **Retry-with-feedback:** pass Jest stderr back to Claude on the next attempt
- **Adaptive priority:** bump priority for surfaces with recent git churn
- **Coverage trend:** track % over multiple scans, show graph in loop report

**Architectural extensions (design doc §11):**
- Playwright matcher for route-level confidence (§11.6)
- Mutation testing oracle to validate assertions aren't vacuous (§11.3)
- Per-surface retry budget so one hard surface doesn't eat the whole loop

---

<!-- _class: title -->

## Thank You

**Repository:** `github.com/alihaidar2950/medplum-coverage-harness`

**Run it yourself:**
```bash
git clone ... medplum-coverage-harness
cd medplum-coverage-harness && npm ci && npm run build
./bin/run.js init --target ../medplum
./bin/run.js scan          # see the 556-unit manifest
./bin/run.js loop --until delta-stalled --verify
```

**137 tests, 10 files, zero mocked databases.**

*Questions?*
