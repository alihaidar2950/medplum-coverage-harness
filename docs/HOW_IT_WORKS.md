# How This Project Works — Plain English Guide

> This document explains the entire `medplum-coverage-harness` codebase
> from first principles. No prior knowledge assumed.

---

## Table of Contents

1. [The Problem Being Solved](#1-the-problem-being-solved)
2. [The Big Idea: Three Axes of Coverage](#2-the-big-idea-three-axes-of-coverage)
3. [System Overview](#3-system-overview)
4. [The Four Commands](#4-the-four-commands)
5. [Step-by-Step: What Happens During `scan`](#5-step-by-step-what-happens-during-scan)
6. [Step-by-Step: What Happens During `close`](#6-step-by-step-what-happens-during-close)
7. [Step-by-Step: What Happens During `loop`](#7-step-by-step-what-happens-during-loop)
8. [The Manifest File (The Database)](#8-the-manifest-file-the-database)
9. [How Test Files Are Read and Understood](#9-how-test-files-are-read-and-understood)
10. [How the AI Agent Is Used](#10-how-the-ai-agent-is-used)
11. [Safety Guardrails](#11-safety-guardrails)
12. [File and Folder Map](#12-file-and-folder-map)
13. [Glossary](#13-glossary)

---

## 1. The Problem Being Solved

The **medplum app** (`packages/app/src/`) is a healthcare web application with
~100 pages (routes). Every page needs tests to make sure it works. Writing
those tests by hand takes a very long time.

This harness does three things automatically:

1. **Finds** every page in the app and asks "which tests should exist for this page?"
2. **Checks** which of those tests actually exist.
3. **Writes** the missing tests using an AI (Claude), then re-checks to see if coverage improved.

Think of it like a **gap detector + auto-fixer** for test coverage.

---

## 2. The Big Idea: Three Axes of Coverage

Every piece of test coverage is described as a **triple**:

```
(Surface, Precondition, Behavior)
```

These three words are the core vocabulary of the entire project.

### Surface — "which page?"

A Surface is one page (route + React component) in the app.

```
Surface example:
  route     = /signin
  component = SignInPage
  file      = packages/app/src/SignInPage.tsx
```

The harness discovers surfaces by reading `AppRoutes.tsx` — the file that
maps URL paths to React components.

### Precondition — "what state is the app in?"

A Precondition describes how the `MockClient` (the fake FHIR server used in
tests) is set up before the test runs.

```
Precondition examples:
  pre.unauthed              → no user logged in
  pre.practitioner.empty    → a doctor is logged in, no patient records
  pre.practitioner.with-patient → a doctor is logged in, 1 Patient exists
  pre.admin.with-project    → an admin is logged in, 1 Project exists
```

There are 5 hand-crafted "seed" preconditions. When the harness sees new
patterns in existing test files, it auto-creates more.

### Behavior — "what should the test check?"

A Behavior is one of 10 fixed verbs describing what the test asserts:

| ID | Plain English |
|----|---------------|
| `beh.renders` | The page loads without crashing |
| `beh.list-displayed` | Items from the database appear on screen |
| `beh.form-submit-success` | Submitting a form works |
| `beh.form-validation-error` | Bad form input shows an error message |
| `beh.navigates` | Clicking something takes you to another page |
| `beh.empty-state` | When there's no data, a "nothing here" message shows |
| `beh.error-state` | When the server fails, an error message shows |
| `beh.phi-masked` | Sensitive patient data is hidden from unauthorized users |
| `beh.audit-event-emitted` | Important actions create an audit log entry |
| `beh.consent-honored` | Patient consent restrictions are respected |

The last 3 are healthcare-specific — they're the ones most likely to cause
legal/compliance problems if missing.

### A Coverage Unit = one test scenario

Combining all three axes gives a **Unit** — one specific test scenario:

```
unit.signin.unauthed.renders
  surface     = surface.signin  (the /signin page)
  precondition = pre.unauthed   (not logged in)
  behavior    = beh.renders     (page loads without crashing)
```

The harness tracks thousands of these units, each with a status:

| Status | Meaning |
|--------|---------|
| `GAP` | No test covers this scenario |
| `COVERED` | A test confidently covers it |
| `PARTIAL` | A test file matches the surface but we're not sure about the precondition |
| `REGRESSION` | This was COVERED before, but the test disappeared |
| `IGNORED` | Deliberately skipped (requires a written reason) |

---

## 3. System Overview

Here is how all the pieces fit together:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI Commands                               │
│   harness init  │  harness scan  │  harness close  │  harness loop │
└────────┬────────┴───────┬────────┴────────┬─────────┴───────┬───┘
         │                │                 │                  │
         ▼                ▼                 ▼                  ▼
    Write config     ┌─────────┐      ┌─────────┐       ┌─────────┐
    harness.config   │  SCAN   │      │  CLOSE  │       │  LOOP   │
    .json            │         │      │         │       │         │
                     │discover │      │pick gap │       │scan→stop│
                     │  +      │      │build    │  loop │ check   │
                     │ score   │      │ prompt  │ ─────▶│→close   │
                     └────┬────┘      │invoke   │       │→log     │
                          │           │ agent   │       └─────────┘
                          ▼           │verify   │
                  coverage.manifest   │re-scan  │
                  .yaml               │report   │
                                      └─────────┘
```

### The one central file: `coverage.manifest.yaml`

Everything revolves around the manifest. Think of it as a **spreadsheet** that
lists every test scenario (unit) and whether it's covered or not.

```
scan  → reads the app → writes manifest (all the GAPs found)
close → reads manifest → writes 1 test → re-reads app → updates manifest
loop  → runs scan+close repeatedly until a goal is met
```

---

## 4. The Four Commands

### `harness init --target ../medplum`

The simplest command. Just writes a config file so all other commands know
where the medplum repo lives.

```
Writes: harness.config.json
Contents: { "target": "../medplum", "scope": ["packages/app/src"] }
```

### `harness scan`

The **discovery + measurement** command. Answers: "how covered are we right now?"

Reads the app → builds the manifest → writes a report.

### `harness close [--gap <id>] [--verify]`

The **one-shot gap fixer**. Answers: "write me a test for this one missing scenario."

Reads manifest → picks one GAP → asks Claude to write a test → (optionally runs it) → re-scans.

### `harness loop --until p0-gaps==0 --verify`

The **autonomous mode**. Keeps running `close` in a loop until a goal is hit
or a safety guardrail fires.

---

## 5. Step-by-Step: What Happens During `scan`

### Phase 1: Route Discovery

File: [src/discover/routes.ts](../src/discover/routes.ts)

The harness opens `packages/app/src/AppRoutes.tsx` in the medplum repo and
reads it as a TypeScript AST (a structured tree of the code, not just text).
It walks through all the `<Route path="..." element={<SomePage />}>` tags and
records every route.

```
AppRoutes.tsx (simplified):
  <Route path="/signin"   element={<SignInPage />} />
  <Route path="/:resourceType" element={<ResourcePage />}>
    <Route path="new"     element={<NewResourcePage />} />
  </Route>

Result:
  { route: "/signin",          component: "SignInPage" }
  { route: "/:resourceType",   component: "ResourcePage" }
  { route: "/:resourceType/new", component: "NewResourcePage" }
```

**Tool used: ts-morph** — a TypeScript library that lets you read `.tsx` files
like a tree (find nodes, get their attributes, walk children) rather than using
fragile text searching.

### Phase 2: Component Resolution

File: [src/discover/components.ts](../src/discover/components.ts)

For each route, the harness finds the actual `.tsx` file on disk:

```
"SignInPage" → tries:
  packages/app/src/SignInPage.tsx        ✓ found
  packages/app/src/SignInPage.ts
  packages/app/src/SignInPage/index.tsx
```

This gives us the `discovered_via` field (the file + line number).

### Phase 3: Surface Categorization

File: [src/discover/index.ts](../src/discover/index.ts) — `categorize()` function

Each route gets bucketed into a category based on its URL pattern:

```
/signin, /register, /mfa          → "auth"
/, /:resourceType                  → "resource-list"
/:resourceType/:id                 → "resource-detail-key"
/:resourceType/:id/notes           → "resource-detail-tab"
/:resourceType/new                 → "resource-create"
/admin/users/invite                → "admin-form"
/admin                             → "admin-list"
/batch, /security                  → "debug"
```

**Why does this matter?** Because not every behavior makes sense on every page.
A list page doesn't have a form, so `beh.form-submit-success` would be
meaningless there. The category drives a **whitelist** of which behaviors apply:

```
"auth" pages get:       renders, form-submit-success, form-validation-error, navigates
"resource-list" gets:   renders, list-displayed, empty-state, phi-masked, navigates
"debug" pages get:      renders, error-state
```

This keeps the number of test scenarios sensible (556 units) instead of
exploding (910 if every behavior applied to every surface).

### Phase 4: Precondition Catalog Discovery

File: [src/discover/mock-catalog.ts](../src/discover/mock-catalog.ts)

The 5 seed preconditions are hard-coded. But the harness also **walks all
existing test files** and learns new precondition patterns:

```
Reads TestFile.test.tsx
  → Finds: new MockClient()
           medplum.setActiveLoginOverride({ admin: true })
           await medplum.createResource({ resourceType: 'Patient' })

  → Signature: { auth: 'admin', resources: [{ resourceType: 'Patient', count: 1 }] }
  → Key: "admin|Patient:1"

Checks against seeds: not found
  → Auto-creates: pre.admin.with-patient
     with an inline code snippet showing how to set it up
```

### Phase 5: Unit Generation

File: [src/discover/index.ts](../src/discover/index.ts) — `buildUnits()` function

Now the harness combines everything into the full unit list:

```
For each surface:
  → Pick matching preconditions (auth routes get unauthed only;
    admin routes get admin only; others get practitioner)
  → Pick applicable behaviors (from the category whitelist)
  → Emit one unit per (surface × precondition × behavior) combo
  → Set status = GAP (no tests exist yet)
```

Example for `/signin`:

```
unit.signin.unauthed.renders
unit.signin.unauthed.form-submit-success
unit.signin.unauthed.form-validation-error
unit.signin.unauthed.navigates
```

### Phase 6: Scoring Existing Tests

Files: [src/score/test-parser.ts](../src/score/test-parser.ts),
[src/score/unit-matcher.ts](../src/score/unit-matcher.ts)

Now the harness walks every `*.test.tsx` file and tries to match each test
to units. It uses **three signals**:

#### Signal 1: Filename → Surface

```
SignInPage.test.tsx  →  component name is "SignInPage"
                    →  matches surface.signin
```

This is straightforward. If the test file is named after a component, it covers that surface.

#### Signal 2: MockClient setup → Precondition

The harness reads the TypeScript AST of the test file looking for `new MockClient(...)` calls:

```
new MockClient({ profile: null })
  → auth = "none"  → pre.unauthed  (confident)

new MockClient({ profile: DrAliceSmith })
  → identifier "DrAliceSmith" is not "admin"
  → auth = "practitioner"  (confident)

medplum.setActiveLoginOverride({ admin: true })
  → auth = "admin"  (confident)

new MockClient()
  → no profile hint
  → auth = "practitioner"  (LOW confidence — just a guess)
```

File: [src/score/mock-call-extractor.ts](../src/score/mock-call-extractor.ts)

If the test also calls `medplum.createResource({ resourceType: 'Patient' })`,
that refines the precondition:
- `practitioner` + Patient → `pre.practitioner.with-patient`
- `admin` + Project → `pre.admin.with-project`

#### Signal 3: Test name/body → Behavior

The harness reads the name and body of each `test(...)` or `it(...)` block
and matches it against keyword patterns:

```
"renders correctly"            →  beh.renders
"shows validation error"       →  beh.form-validation-error
"navigates to patient"         →  beh.navigates
"displays empty state"         →  beh.empty-state
"list shows patients"          →  beh.list-displayed
```

File: [src/score/unit-matcher.ts](../src/score/unit-matcher.ts) — `classifyBehavior()`

#### COVERED vs PARTIAL

- **COVERED**: filename matched a surface AND the mock setup gave a confident signal
- **PARTIAL**: filename matched but the mock setup was ambiguous (bare `new MockClient()`)

Partial is honest — it says "there's a test file here but we're not sure which precondition it exercises."

### Phase 7: Regression Detection

File: [src/score/regression-detector.ts](../src/score/regression-detector.ts)

Before writing the new manifest, the harness compares it to the previous one
(saved as `coverage.manifest.previous.yaml`):

```
Previous: unit.signin.unauthed.renders = COVERED
Current:  unit.signin.unauthed.renders = GAP

→ Someone deleted the test!
→ Mark as REGRESSION (not just GAP)
```

### Phase 8: Write Manifest and Report

```
coverage.manifest.yaml           ← full database of all units + statuses
reports/scan-2026-05-10.md       ← human-readable summary
```

The scan report shows:
- Total units, covered %, gaps by priority
- Any regressions found
- Sample of the highest-priority gaps

---

## 6. Step-by-Step: What Happens During `close`

The `close` command picks one GAP and tries to fix it.

```
┌──────────────┐
│  Read manifest│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Pick a gap   │  (strategy: highest-priority, regression-first,
└──────┬───────┘             fewest-deps, random)
       │
       ▼
┌──────────────────────────────┐
│  Build a prompt for Claude    │
│  (fill in template with       │
│   surface, precondition,      │
│   behavior details)           │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Spawn: claude --print ...    │
│  (headless AI call)           │
│  Claude writes 1 test file    │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────┐
│ File exists?  │──NO──→ agentOutcome = failure
└──────┬───────┘
       │YES
       ▼
┌──────────────┐          ┌─────────────────────────┐
│  --verify?   │──YES──→  │  Run: npx jest <file>    │
└──────┬───────┘          │  compile-ok-tests-pass?  │
       │NO                │  compile-ok-tests-fail?  │
       │                  │  compile-failed?          │
       │                  │                          │
       │                  │  NOTE: always compile-   │
       │                  │  failed if medplum hasn't│
       │                  │  been built (npm ci +    │
       │                  │  npm run build). See     │
       │                  │  design.md §11.9.        │
       ▼                  └─────────────┬────────────┘
┌──────────────────────────────────────┐│
│  Re-scan the whole repo               ◄┘
│  (discover + score again)            │
│  Compute delta:                      │
│    covered before: 42                │
│    covered after:  43                │
│    delta = +1                        │
└──────────────┬───────────────────────┘
               │
               ▼
        Write close report
        reports/close-2026-05-10.md
```

### The Gap Picker

File: [src/close/gap-picker.ts](../src/close/gap-picker.ts)

Four strategies for choosing which gap to close next:

| Strategy | Logic |
|----------|-------|
| `highest-priority` | P0 first, then P1, then P2. Alphabetical tie-break. |
| `regression-first` | Regressions before new gaps; within each group, by priority. |
| `fewest-deps` | Pick the simplest precondition (unauthed → practitioner.empty → practitioner.with-patient → ...) |
| `random` | Pick randomly. Useful for exploration. |

### The Prompt Template

File: [prompts/close-gap.md](../prompts/close-gap.md)

The prompt has placeholders like `{{surface.route}}` that get filled in:

```
You are writing ONE Jest test file to close a specific coverage gap.

Surface:      /signin  (SignInPage)
Precondition: pre.unauthed — unauthenticated MockClient — no signed-in user
Behavior:     beh.form-validation-error — invalid form submit shows validation message

# MockClient setup snippet
const medplum = new MockClient({ profile: null });

# Behavior assertion guidance
[guidance from behavior-assertions.md]

Output ONLY the test file contents, no commentary.
```

File: [src/close/prompt-builder.ts](../src/close/prompt-builder.ts)

The mock setup snippet comes from one of two places:
1. **Inline snippet** — for auto-discovered preconditions, the snippet is stored
   directly in the precondition record (no extra file needed)
2. **Markdown section** — for the 5 seed preconditions, the snippet lives in
   `prompts/mock-setups.md` under a `## pre.unauthed` heading

### Agent Safety: The Write Fence

File: [agent-context/.claude/hooks/pre-write-fence.sh](../agent-context/.claude/hooks/pre-write-fence.sh)

When Claude tries to write a file, a bash "hook" intercepts the call first:

```bash
# Hook receives JSON: { "tool": "Write", "input": { "file_path": "..." } }
# Check: does file_path end with the EXPECTED_TEST_FILE we set?
# No → reject with error, Claude cannot write it
# Yes → allow
```

This means Claude **cannot write to any file except the one we told it to**.
Even if Claude's instructions say "also edit this other file," the hook blocks it.

File: [agent-context/.claude/settings.json](../agent-context/.claude/settings.json)
also restricts Claude to the `Write` tool only — no `Bash`, no `Edit`, no web access.

---

## 7. Step-by-Step: What Happens During `loop`

The loop runs `scan → close → scan → close → ...` automatically until something stops it.

```
START
  │
  ▼
┌─────────────────────────────────────────┐
│  SCAN  (get fresh manifest)             │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  CHECK STOPPING CONDITIONS              │
│  ─────────────────────────────          │
│  GUARDRAILS (safety, checked first):    │
│    iterations ≥ cap?       → STOP       │
│    elapsed ≥ budget?       → STOP       │
│    3 failures in a row?    → STOP       │
│    quality decaying?       → STOP       │
│                                         │
│  USER GOALS (checked second, OR logic): │
│    p0-gaps == 0?           → STOP       │
│    regressions == 0?       → STOP       │
│    coverage ≥ N%?          → STOP       │
│    3 iterations no progress? → STOP     │
└──────┬─────────────────┬────────────────┘
       │ still running   │ should stop
       │                 ▼
       │           ┌─────────────────────┐
       │           │  Write loop report  │
       │           │  Explain why stopped│
       │           └─────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  CLOSE one gap (pick → prompt → agent   │
│  → optional verify → re-scan)           │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  LOG this iteration:                    │
│    which gap was picked                 │
│    did agent succeed?                   │
│    did tests pass?                      │
│    how many units changed?              │
└──────┬──────────────────────────────────┘
       │
       └──────────────────────────────────▶ back to SCAN
```

File: [src/loop/index.ts](../src/loop/index.ts)

### The Stopping Conditions in Detail

File: [src/loop/stopping-conditions.ts](../src/loop/stopping-conditions.ts)

**Guardrails are safety limits — they fire even if the goal isn't met:**

```
iterations >= N    → default N=10, user can tune with --iterations
budget exceeded    → default 30min, user tunes with --budget
failures >= N      → default 3 consecutive agent/compile failures
quality-decay      → if --verify is on: last 5 verified iterations,
                     <50% produced compileable TypeScript → stop
```

**User goals fire when the target is achieved:**

```
--until p0-gaps==0     → all P0 (critical) gaps are closed
--until regressions==0 → all regressions are fixed
--until coverage>=50%  → 50% or more units are COVERED
--until delta-stalled  → last 3 iterations added zero covered units
```

Multiple `--until` conditions are OR'd — the first one that fires stops the loop.

**Why guardrails come first:** The user might write `--until coverage>=100%`
which is impossible. Without the iteration cap guardrail, the loop would run forever.

### The Loop Report

After stopping, the loop writes a markdown report at `reports/loop-<timestamp>.md`:

```markdown
# Loop Report
**Started:** 2026-05-10T06:00:00Z | **Stopped:** 2026-05-10T06:08:43Z

## Why we stopped
Goal met — p0-gaps==0 — all high-priority gaps were closed successfully.

## Config
iterations_max=10, budget=30min, strategy=highest-priority, verify=true

## Summary
Total iterations: 5
Agent successes: 4 | failures: 1
Tests passing: 3 | failing: 1 | compile errors: 0

## Per-iteration
| # | Gap | Priority | Agent | Verify | +Covered | +Partial |
|---|-----|----------|-------|--------|----------|----------|
| 1 | unit.signin.unauthed.renders | P0 | success | pass | +1 | 0 |
...
```

File: [src/report/loop-report.ts](../src/report/loop-report.ts)

---

## 8. The Manifest File (The Database)

The manifest (`coverage.manifest.yaml`) is the central state file. Here is a
real annotated example:

```yaml
version: 1
generated_at: "2026-05-10T06:00:00.000Z"   # when this scan ran
target:
  repo: /path/to/medplum
  scope: [packages/app/src]

# ── SURFACES ──────────────────────────────────────────────────────────────────
# One entry per discovered route + component pair
surfaces:
  - id: surface.signin           # stable ID derived from route
    route: /signin               # the URL
    component: SignInPage        # the React component name
    discovered_via: packages/app/src/SignInPage.tsx:42  # where we found it

# ── PRECONDITIONS ─────────────────────────────────────────────────────────────
# The 5 hand-crafted + any auto-discovered ones
preconditions:
  - id: pre.unauthed
    description: unauthenticated MockClient — no signed-in user
    auth: none
    resources: []
    mock_setup_ref: prompts/mock-setups.md#pre.unauthed
    # ↑ Points to the code snippet in that file

  - id: pre.practitioner.with-patient
    auth: practitioner
    resources: [{resourceType: Patient, count: 1}]
    mock_setup_ref: prompts/mock-setups.md#pre.practitioner.with-patient

  - id: pre.admin.with-patient        # ← AUTO-DISCOVERED from test files
    auth: admin
    resources: [{resourceType: Patient, count: 1}]
    mock_setup_ref: auto-discovered   # ← decorative only
    auto_discovered: true
    mock_setup_snippet: |             # ← inline code, no separate file needed
      const medplum = new MockClient();
      medplum.setActiveLoginOverride({...});
      await medplum.createResource({ resourceType: 'Patient' });

# ── BEHAVIORS ─────────────────────────────────────────────────────────────────
# Fixed list of 10 behaviors
behaviors:
  - id: beh.renders
    description: component mounts without throwing
    assertion_ref: prompts/behavior-assertions.md#beh.renders

# ── UNITS ─────────────────────────────────────────────────────────────────────
# Every (surface × precondition × behavior) combo that applies
units:
  - id: unit.signin.unauthed.renders
    surface: surface.signin
    precondition: pre.unauthed
    behavior: beh.renders
    priority: P0            # P0 = critical, P1 = important, P2 = nice-to-have
    status: COVERED         # This test exists!
    covered_by:
      - packages/app/src/SignInPage.test.tsx

  - id: unit.signin.unauthed.form-validation-error
    surface: surface.signin
    precondition: pre.unauthed
    behavior: beh.form-validation-error
    priority: P0
    status: GAP             # No test for this yet
    covered_by: []
```

### How unit IDs are built

```
unit.signin.unauthed.renders
  │     │       │       │
  │     │       │       └── behavior (stripped "beh." prefix)
  │     │       └────────── precondition (stripped "pre." prefix)
  │     └────────────────── surface slug (stripped "surface." prefix)
  └──────────────────────── always "unit"
```

### Priority Assignment

```
route = "/"             → P0  (home page, critical)
route = "/signin"       → P0  (auth page, critical)
route = "/:resourceType" → P1  (clinical data, important)
route = "/admin/..."    → P2  (admin, nice to have)
route = "/batch"        → P2  (utility, nice to have)
```

---

## 9. How Test Files Are Read and Understood

### The Parser

File: [src/score/test-parser.ts](../src/score/test-parser.ts)

When the harness reads a test file like `SignInPage.test.tsx`, it uses **ts-morph**
to build a tree of the code, then walks that tree looking for specific patterns.

**What it extracts:**

```typescript
// Given this test file:
import { SignInPage } from './SignInPage';
import { MockClient } from '@medplum/mock';

const medplum = new MockClient({ profile: null });

test('shows validation error', async () => {
  render(<SignInPage />);
  fireEvent.click(screen.getByText('Sign in'));
  expect(screen.getByText('Email is required')).toBeInTheDocument();
});

// Parser produces:
{
  filePath: "/medplum/packages/app/src/SignInPage.test.tsx",
  baseName: "SignInPage",                           // ← filename without .test.tsx
  importedComponents: ["SignInPage", "MockClient"],  // ← all named imports
  mockClientProfiles: [{ kind: "null" }],           // ← profile: null found
  hasSetActiveLoginOverride: false,
  createdResourceTypes: [],                          // ← no createResource calls
  testCases: [{
    name: "shows validation error",
    bodyText: "render(<SignInPage />)..."
  }]
}
```

### The Matcher

File: [src/score/unit-matcher.ts](../src/score/unit-matcher.ts)

Takes a `ParsedTest` and a `Manifest` and returns which units this test covers:

```
Step 1: baseName === "SignInPage"
        → matches surface.signin (component: "SignInPage") ✓

Step 2: profile is null
        → classifyMockSetup returns pre.unauthed, confident=true ✓

Step 3: test name "shows validation error"
        → keyword "validation" matches beh.form-validation-error ✓
        → also emit beh.renders (every test with any test cases covers renders)

Step 4: Find units in manifest where:
        surface=surface.signin AND precondition=pre.unauthed AND behavior in {renders, form-validation-error}

→ Returns:
  [
    { unitId: "unit.signin.unauthed.renders",             status: "COVERED" },
    { unitId: "unit.signin.unauthed.form-validation-error", status: "COVERED" }
  ]
```

---

## 10. How the AI Agent Is Used

### The Big Picture

The harness doesn't ask Claude to "figure out what tests to write." Instead, it
gives Claude a very **specific, narrow instruction**:

```
"Here is one gap:
  Page: /signin (SignInPage)
  Setup: not logged in (pre.unauthed)
  Test: validate that invalid form input shows an error (beh.form-validation-error)

Write exactly this one test file.
The file must go here: packages/app/src/SignInPage.beh.form-validation-error.test.tsx
Use MockClient like this: [code snippet]
The assertion should look like this: [guidance]"
```

### The Invocation

File: [src/close/agent-invoker.ts](../src/close/agent-invoker.ts)

The harness spawns the `claude` CLI as a child process:

```bash
claude \
  --print \                     # non-interactive (headless) mode
  --output-format text \        # return plain text, not JSON
  --allowedTools Write \        # Claude can ONLY use the Write tool
  --add-dir agent-context \     # load constrained settings from this folder
  < prompt.txt                  # prompt is piped in on stdin
```

The `agent-context/` folder contains:
- `settings.json` — restricts Claude to Write-only, wires up the fence hook
- `hooks/pre-write-fence.sh` — rejects any Write to the wrong path
- `CLAUDE.md` — tells Claude what its job is in this context

### The Fence Hook in Detail

When Claude tries to write a file, before the write happens, the fence script runs:

```bash
#!/bin/bash
# Read the tool-use JSON from stdin
INPUT=$(cat)

# Extract the file path Claude wants to write to
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['input']['file_path'])")

# Check against the expected path
if [[ "$FILE_PATH" == *"$EXPECTED_TEST_FILE" ]]; then
  exit 0   # Allow the write
else
  echo "Rejected: may only write to $EXPECTED_TEST_FILE"
  exit 2   # Block the write
fi
```

`EXPECTED_TEST_FILE` is set by the harness as an environment variable before
spawning Claude. This is the "tool-layer constraint" — the fence runs at the OS
level, not in the prompt. Claude cannot talk its way past it.

### What Happens After

The harness doesn't trust Claude's stdout output. Instead, it just checks:
**"Did the expected file appear on disk?"**

```typescript
if (fs.existsSync(expectedAbsPath)) {
  generatedTest = fs.readFileSync(expectedAbsPath, 'utf8');
  agentOutcome = 'success';
} else {
  reason = 'agent did not write the expected file';
  agentOutcome = 'failure';
}
```

### Verify (Optional)

If `--verify` is passed, the harness runs Jest on the generated file:

```bash
npx jest packages/app/src/SignInPage.beh.form-validation-error.test.tsx
```

It classifies the outcome by looking for error patterns in the output:

```
"Test suite failed to run" or "TSError" → compile-failed
exit code = 0                          → compile-ok-tests-pass
exit code ≠ 0, no compile error        → compile-ok-tests-fail
spawn error / timeout                  → not-run
```

File: [src/close/verify.ts](../src/close/verify.ts)

`compile-ok-tests-fail` (TypeScript compiled fine but test assertions failed)
is treated as "progress" — the structure is right, just the assertions need
tweaking. Only `compile-failed` (TypeScript errors) counts as a "failure" for
the guardrail counter.

---

## 11. Safety Guardrails

The loop has four guardrails that are **always on** — the user can tune the
thresholds but cannot disable them.

### Why they exist

Without guardrails, `harness loop --until coverage>=100%` could run forever
trying to reach an impossible goal.

### 1. Iteration Cap (default: 10)

```
After N iterations, stop regardless.
Tuned with: --iterations 20
```

### 2. Budget (default: 30 minutes)

```
After N minutes of wall-clock time, stop.
Tuned with: --budget 60
```

### 3. Consecutive Failures (default: 3)

```
If the agent fails 3 times in a row (no file produced, or compile error),
something is wrong. Stop and let a human look.
Tuned with: --max-failures 5
```

"Failure" counts are reset when a success happens. So: fail, fail, **success**,
fail, fail → only 2 consecutive failures, not 4.

### 4. Quality Decay (only when --verify is on)

```
If fewer than 50% of the last 5 verified tests compile cleanly,
the agent is producing broken TypeScript. Stop.
(Not configurable — it's always 50%/5-iteration window)
```

This catches the case where Claude is confidently generating syntactically
invalid code over and over.

---

## 12. File and Folder Map

```
medplum-coverage-harness/
│
├── src/                     ALL SOURCE CODE
│   │
│   ├── commands/            CLI LAYER (what runs when you type "harness ...")
│   │   ├── init.ts          harness init
│   │   ├── scan.ts          harness scan
│   │   ├── close.ts         harness close
│   │   └── loop.ts          harness loop
│   │
│   ├── schema/              DATA SHAPES AND VALIDATION
│   │   ├── manifest.ts      Zod schemas for Surface, Precondition, Behavior, Unit, Manifest
│   │   └── refs.ts          Validates that prompt snippets actually exist
│   │
│   ├── discover/            READING THE APP — what pages exist?
│   │   ├── routes.ts        Reads AppRoutes.tsx → list of (route, component)
│   │   ├── components.ts    Resolves component name → .tsx file path
│   │   ├── mock-catalog.ts  Builds the precondition list (seeds + auto-discovered)
│   │   └── index.ts        Orchestrates discover, builds full manifest
│   │
│   ├── score/               READING THE TESTS — what's covered?
│   │   ├── test-parser.ts   Reads .test.tsx file → extracts MockClient, test names
│   │   ├── mock-call-extractor.ts  Maps MockClient setup → precondition ID
│   │   ├── unit-matcher.ts  Three-signal matching (filename, mock, behavior)
│   │   ├── regression-detector.ts  Detects COVERED→GAP regressions
│   │   └── index.ts         scan() = discover() + scoreUnits()
│   │
│   ├── close/               FIXING A GAP — runs Claude to write a test
│   │   ├── gap-picker.ts    Chooses which GAP to close next
│   │   ├── prompt-builder.ts  Fills in the close-gap.md template
│   │   ├── agent-invoker.ts   Spawns the claude CLI process
│   │   ├── verify.ts          Runs Jest on the generated file
│   │   ├── delta-reporter.ts  Computes covered/partial count changes
│   │   └── index.ts           closeOne() — the full orchestration
│   │
│   ├── loop/                AUTONOMOUS MODE — runs scan+close repeatedly
│   │   ├── stopping-conditions.ts  All guardrails + user goals
│   │   ├── budget-tracker.ts       Tracks iterations, failures, elapsed time
│   │   ├── iteration-logger.ts     Records each iteration to JSON
│   │   └── index.ts               runLoop() — the main loop
│   │
│   ├── report/              HUMAN-READABLE OUTPUTS
│   │   ├── scan-report.ts   Markdown report after a scan
│   │   ├── close-report.ts  Markdown report after a close
│   │   └── loop-report.ts   Markdown report after a loop finishes
│   │
│   └── util/                SHARED HELPERS
│       ├── paths.ts         File path resolution (where is the manifest? reports dir?)
│       ├── yaml.ts          Read/write YAML manifest with Zod validation
│       ├── markdown.ts      Extract ## sections from .md files
│       └── logger.ts        info/warn/error logging
│
├── prompts/                 TEMPLATES FOR CLAUDE
│   ├── close-gap.md         The main prompt template (with {{placeholders}})
│   ├── mock-setups.md       Code snippets for each seed precondition
│   └── behavior-assertions.md  Guidance per behavior (what to assert)
│
├── agent-context/           CLAUDE'S CONSTRAINED ENVIRONMENT
│   └── .claude/
│       ├── CLAUDE.md        Instructions shown to Claude when it's invoked
│       ├── settings.json    Allows Write only, blocks everything else
│       └── hooks/
│           └── pre-write-fence.sh  Blocks writes to wrong paths
│
├── tests/                   THIS PROJECT'S OWN TESTS (Vitest)
│   ├── schema.test.ts       Tests the Zod schemas
│   ├── discover.test.ts     Tests route discovery + categorization
│   ├── score.test.ts        Tests the test parser + matcher
│   ├── mock-catalog.test.ts Tests precondition auto-discovery
│   ├── close.test.ts        Tests the close orchestration
│   ├── stopping-conditions.test.ts  Tests all guardrail logic
│   ├── loop-report.test.ts  Tests the loop report renderer
│   ├── refs.test.ts         Tests prompt reference validation
│   └── claude-context.test.ts  Tests the agent-context files
│
├── harness.config.json      Where medplum lives (written by "harness init")
├── coverage.manifest.yaml   The current coverage state (gitignored, generated)
├── CLAUDE.md                Instructions for Claude when working IN this repo
└── package.json             oclif CLI setup, dependencies
```

---

## 13. Glossary

| Term | Plain English |
|------|--------------|
| **Surface** | One page in the medplum app (a route + React component) |
| **Precondition** | How MockClient is set up — who is logged in, what data exists |
| **Behavior** | What a test should check (one of 10 fixed verbs) |
| **Unit** | One specific test scenario = Surface + Precondition + Behavior |
| **GAP** | A test scenario with no test written yet |
| **COVERED** | A test scenario that has a test |
| **PARTIAL** | A test file matches the surface but we're not sure about the precondition |
| **REGRESSION** | Was COVERED before, now the test is gone |
| **IGNORED** | Deliberately skipped (needs a written reason) |
| **MockClient** | A fake FHIR server from `@medplum/mock` — used in tests instead of a real server |
| **ts-morph** | A library for reading TypeScript code as a tree (not just text) |
| **AST** | Abstract Syntax Tree — the tree structure ts-morph produces |
| **Manifest** | The YAML file that stores all surfaces, preconditions, behaviors, and unit statuses |
| **Guardrail** | A safety limit that stops the loop (iterations, budget, failures, quality) |
| **Goal** | A user-supplied condition that stops the loop when met (`--until p0-gaps==0`) |
| **Delta** | The change in covered/partial unit counts after one close operation |
| **Seed precondition** | One of the 5 hand-crafted preconditions (always present) |
| **Auto-discovered precondition** | A precondition synthesized from patterns seen in existing test files |
| **Inline snippet** | A MockClient setup code snippet stored directly in the precondition record |
| **Write fence** | The bash hook that blocks Claude from writing to any file except the expected one |
| **Scan** | The full discover + score + regression-detect process |
| **Close** | One iteration: pick gap → prompt → agent → (verify) → re-scan |
| **Loop** | Repeated close iterations under guardrail control |
| **P0 / P1 / P2** | Priority levels: critical / important / nice-to-have |
| **oclif** | The CLI framework (like commander.js or yargs) used to build the commands |
| **Zod** | A TypeScript library for declaring and validating data shapes at runtime |
| **FHIR** | The healthcare data standard (Patient, Encounter, etc. are FHIR resource types) |
| **PHI** | Protected Health Information — patient data that must be kept private |

---

*This document was written against the codebase at commit `adfe87a`.
If something doesn't match, `git log --oneline` and re-read the relevant source file.*
