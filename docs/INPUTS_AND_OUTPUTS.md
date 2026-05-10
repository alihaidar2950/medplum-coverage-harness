# Inputs, Outputs, and What's Hardcoded — and Why

> This document answers one question from every angle:
> **"Where does each piece of data come from, and who is responsible for it?"**

---

## The Three Authors

Everything in this system is written by one of three authors:

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   YOU (human)   │   │  THE HARNESS    │   │   CLAUDE (AI)   │
│                 │   │   (the code)    │   │                 │
│ Write once,     │   │ Runs every time │   │ Runs when you   │
│ rarely change   │   │ you scan/close  │   │ call close/loop │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

---

## Visual Map of Every File

```
medplum-coverage-harness/
│
├── [YOU] harness.config.json              ← you write this once (via harness init)
├── [YOU] prompts/close-gap.md             ← you write this template
├── [YOU] prompts/mock-setups.md           ← you write the 5 seed snippets
├── [YOU] prompts/behavior-assertions.md   ← you write the 10 guidance blocks
├── [YOU] agent-context/.claude/CLAUDE.md  ← you write Claude's runtime instructions
├── [YOU] agent-context/.claude/settings.json  ← you write the tool restrictions
├── [YOU] agent-context/.claude/hooks/pre-write-fence.sh  ← you write the fence
│
├── [HARNESS] coverage.manifest.yaml       ← harness generates this on every scan
├── [HARNESS] coverage.manifest.previous.yaml  ← harness saves the old one here
├── [HARNESS] reports/scan-<timestamp>.md  ← harness generates after each scan
├── [HARNESS] reports/close-<timestamp>.md ← harness generates after each close
├── [HARNESS] reports/loop-<timestamp>.md  ← harness generates after each loop
├── [HARNESS] reports/iteration-log.json   ← harness appends during loop
│
└── medplum/packages/app/src/
    └── [CLAUDE] SomePage.beh.renders.test.tsx  ← Claude writes the test files here
```

---

## Section 1: What YOU Write (Hardcoded)

These files exist in the repo and you edit them manually. They encode **decisions that require human judgment** — what behaviors matter, what patterns mean what, how to set things up.

---

### 1a. `harness.config.json` — Where Is Medplum?

```json
{
  "target": "../medplum",
  "scope": ["packages/app/src"]
}
```

**You write:** Once, by running `harness init --target ../medplum`.

**Why hardcoded:** The harness doesn't know where you put the medplum repo. This is user-specific (your machine's file layout).

**What would break without it:** Every other command would fail — they all need to know where to find AppRoutes.tsx, the test files, and where to write generated tests.

---

### 1b. `prompts/close-gap.md` — The Instructions Given to Claude

This is the **master template** for what Claude is told when asked to write a test. It has placeholders (`{{surface.route}}`, `{{precondition.mock_setup_snippet}}`, etc.) that the harness fills in at runtime.

```markdown
You are writing ONE Jest test file to close a specific coverage gap.

Surface:      {{surface.route}}  ({{surface.component}})
Precondition: {{precondition.id}} — {{precondition.description}}
Behavior:     {{behavior.id}} — {{behavior.description}}

# Hard constraints
- Use @medplum/mock → MockClient for all FHIR state. No real API calls.
...

# MockClient setup snippet
{{precondition.mock_setup_snippet}}

# Behavior assertion guidance
{{behavior.assertion_guidance}}

Output ONLY the test file contents, no commentary.
```

**You write:** The template, the constraints, the format rules.

**Harness fills in at runtime:** All the `{{...}}` placeholders (different every time, depending on which gap is being closed).

**Why hardcoded:** These are the rules of the game — what a "good test" means in this codebase. Changing them changes what Claude produces. This is an engineering decision, not data.

---

### 1c. `prompts/mock-setups.md` — Code Snippets for the 5 Seed Preconditions

Each `## pre.<id>` heading contains a TypeScript snippet showing how to set up MockClient for that precondition. The harness reads these at close time and splices them into the prompt.

```markdown
## pre.unauthed

```ts
const medplum = new MockClient({ profile: null });
```

## pre.practitioner.with-patient

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
await medplum.createResource({ resourceType: 'Patient', name: [...] });
```
```

**You write:** The snippets for each of the 5 seed preconditions.

**Auto-discovered preconditions bypass this file entirely** — they carry their snippet inline (see Section 2c below).

**Why hardcoded:** The 5 seeds represent the "official" setup patterns you've decided are standard. They're human-reviewed and authoritative.

---

### 1d. `prompts/behavior-assertions.md` — What Each Behavior Should Assert

Each `## beh.<id>` heading explains what a test for that behavior should check:

```markdown
## beh.phi-masked

Assert that PHI fields the current role is NOT cleared to view are masked
or absent in the DOM. For an unauthorized viewer, expect names/MRNs/birthDates
to be either redacted or not rendered at all...
```

**You write:** The guidance text for all 10 behaviors.

**Harness reads at close time:** Splices the matching section into the prompt as `{{behavior.assertion_guidance}}`.

**Why hardcoded:** These are healthcare compliance requirements translated into testing instructions. They encode domain expertise — they don't change just because the app changes.

---

### 1e. The Agent Context Overlay — Claude's Sandbox

Three files that constrain what Claude is allowed to do when invoked:

#### `agent-context/.claude/settings.json`
```json
{
  "permissions": {
    "allow": ["Write"],
    "deny": ["Bash(:*)", "Edit", "MultiEdit", "WebFetch", "WebSearch"]
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "Write", "hooks": [...fence hook...] }]
  }
}
```
**You write:** The tool allow/deny list. This is a security boundary.

#### `agent-context/.claude/hooks/pre-write-fence.sh`
A bash script that intercepts every Write call and rejects it if the path doesn't match the expected test file.

**You write:** The fence logic. It reads `EXPECTED_TEST_FILE` (set by the harness) and blocks anything else.

#### `agent-context/.claude/CLAUDE.md`
Runtime instructions for Claude — "here is how medplum tests work, follow these patterns."

**You write:** The testing conventions, MockClient patterns, output format.

**Why all three are hardcoded:** These are the safety cage around Claude. They're the "physical" constraints (at the OS/process level) that prevent Claude from doing things the prompt alone can't prevent.

---

### 1f. The Rules Baked Into Source Code

Some things are hardcoded directly in TypeScript. These represent **design decisions** you'd only change if you fundamentally changed the system.

#### The 10 Behaviors — `src/discover/index.ts`

```typescript
const BEHAVIORS: Behavior[] = [
  { id: 'beh.renders', description: 'component mounts without throwing', ... },
  { id: 'beh.list-displayed', ... },
  { id: 'beh.form-submit-success', ... },
  { id: 'beh.form-validation-error', ... },
  { id: 'beh.navigates', ... },
  { id: 'beh.empty-state', ... },
  { id: 'beh.error-state', ... },
  { id: 'beh.phi-masked', ... },          // healthcare-specific
  { id: 'beh.audit-event-emitted', ... }, // healthcare-specific
  { id: 'beh.consent-honored', ... },     // healthcare-specific
];
```

**Why hardcoded:** These are the vocabulary of the system. Changing them changes the meaning of "coverage." They're a deliberate design choice, not data.

#### The Behavior Whitelist Per Page Category — `src/discover/index.ts`

```typescript
const BEHAVIORS_BY_CATEGORY = {
  'auth':            ['beh.renders', 'beh.form-submit-success', ...],
  'resource-list':   ['beh.renders', 'beh.list-displayed', 'beh.phi-masked', ...],
  'admin-form':      ['beh.renders', 'beh.form-submit-success', 'beh.audit-event-emitted'],
  'debug':           ['beh.renders', 'beh.error-state'],
  ...
}
```

**Why hardcoded:** This is domain knowledge — a `/signin` page doesn't have `beh.list-displayed` because there's no list. A debug page doesn't need `beh.phi-masked`. These rules encode what's *sensible*, not what's *technically possible*.

**Without this:** You'd get 910 test scenarios instead of 556, most of them nonsensical (e.g. "test that the sign-in page shows an empty state").

#### The 5 Seed Preconditions — `src/discover/mock-catalog.ts`

```typescript
const SEED_CATALOG: Precondition[] = [
  { id: 'pre.unauthed', auth: 'none', resources: [] },
  { id: 'pre.practitioner.empty', auth: 'practitioner', resources: [] },
  { id: 'pre.practitioner.with-patient', auth: 'practitioner', resources: [{ resourceType: 'Patient', count: 1 }] },
  { id: 'pre.admin.empty', auth: 'admin', resources: [] },
  { id: 'pre.admin.with-project', auth: 'admin', resources: [{ resourceType: 'Project', count: 1 }] },
];
```

**Why hardcoded:** These are the baseline setups every healthcare app always needs, regardless of what tests already exist. They're the "known good starting point."

#### The Route Categorization Rules — `src/discover/index.ts`

```typescript
function categorize(route: string): SurfaceCategory {
  if (isAuthRoute(route)) return 'auth';              // /signin, /register, etc.
  if (route === '/:resourceType') return 'resource-list';
  if (route === '/:resourceType/new') return 'resource-create';
  if (route === '/:resourceType/:id') return 'resource-detail-key';
  if (route.startsWith('/admin')) return 'admin-...';
  ...
}
```

**Why hardcoded:** This is pattern knowledge about the medplum app's URL structure — what kind of page each URL type is. It's stable and only changes if medplum fundamentally restructures its routes.

#### The Priority Rules — `src/discover/index.ts`

```typescript
function priorityFor(route: string): Priority {
  if (route === '/') return 'P0';         // home page — critical
  if (isAuthRoute(route)) return 'P0';   // auth pages — critical
  if (route.startsWith('/admin')) return 'P2'; // admin — lower priority
  return 'P1';                            // everything else
}
```

**Why hardcoded:** Priority is a business decision ("what matters most?"), not something you can derive from code.

#### The Keyword Patterns for Behavior Detection — `src/score/unit-matcher.ts`

```typescript
function classifyBehavior(tc: TestCase): BehaviorId | undefined {
  const haystack = `${tc.name}\n${tc.bodyText}`.toLowerCase();
  if (/\b(validation|invalid|required|missing)\b/.test(haystack)) return 'beh.form-validation-error';
  if (/\b(submit|save|sign in|register)\b/.test(haystack))         return 'beh.form-submit-success';
  if (/\b(redirect|navigate|goes to)\b/.test(haystack))            return 'beh.navigates';
  ...
}
```

**Why hardcoded:** Someone had to decide that "shows validation error" → `beh.form-validation-error`. These patterns are the "what does a test name mean?" rules. They're engineering judgment.

---

## Section 2: What the HARNESS Generates Automatically

These files don't exist before you run a command. The harness creates them by reading the app and the existing tests.

---

### 2a. The Surfaces List (inside the manifest)

**Generated by:** `src/discover/routes.ts` + `src/discover/components.ts`

**Input:** `medplum/packages/app/src/AppRoutes.tsx`

**Output:** A list of `{ id, route, component, discovered_via }` objects

```
Reads this:
  <Route path="/signin" element={<SignInPage />} />

Produces this:
  {
    id: "surface.signin",
    route: "/signin",
    component: "SignInPage",
    discovered_via: "packages/app/src/SignInPage.tsx:42"
  }
```

**Why auto-generated:** The app's routes change as developers add pages. If surfaces were hardcoded, you'd have to manually update the harness every time a new page is added. Auto-discovery means it stays in sync automatically — just re-run `harness scan`.

---

### 2b. The Units List (inside the manifest)

**Generated by:** `src/discover/index.ts` — `buildUnits()`

**Input:** Surfaces list + Preconditions list + the hardcoded whitelist rules

**Output:** Every `(surface × precondition × behavior)` combination that passes the filters

```
For surface.signin (auth category):
  × pre.unauthed (only unauthed for auth routes)
  × [beh.renders, beh.form-submit-success, beh.form-validation-error, beh.navigates]
  = 4 units, all starting as GAP

For surface.resource-list:
  × pre.practitioner.empty, pre.practitioner.with-patient (practitioner only)
  × [beh.renders, beh.list-displayed, beh.empty-state, beh.phi-masked, beh.navigates]
  = 10 units
```

**Why auto-generated:** The unit list is a consequence of the other three things (surfaces, preconditions, behaviors + whitelist rules). Computing it by hand would be error-prone and tedious.

---

### 2c. Auto-Discovered Preconditions (inside the manifest)

**Generated by:** `src/discover/mock-catalog.ts` — `discoverMockCatalog()`

**Input:** All `*.test.tsx` files in `medplum/packages/app/src/`

**Output:** New precondition entries for MockClient patterns not in the 5 seeds

```
Reads: SomeAdminPage.test.tsx
  Finds: medplum.setActiveLoginOverride(...)   → auth = admin
         medplum.createResource({ resourceType: 'Patient' }) → resources = [Patient:1]

Signature key: "admin|Patient:1"
Checks seeds: not there!
Creates:
  {
    id: "pre.admin.with-patient",
    auth: "admin",
    resources: [{ resourceType: "Patient", count: 1 }],
    auto_discovered: true,
    mock_setup_snippet: `
      const medplum = new MockClient();
      medplum.setActiveLoginOverride({...admin...});
      await medplum.createResource({ resourceType: 'Patient', ... });
    `
  }
```

**Why auto-generated:** As the medplum app grows, developers add new test setups. Auto-discovery means the precondition catalog stays in sync with the actual test patterns in the codebase — no manual update required.

**Why does the snippet come inline (not from mock-setups.md)?** Because auto-discovered preconditions aren't hand-reviewed, so they don't get their own named section in the markdown file. The snippet is synthesized from the pattern and carried directly in the record.

---

### 2d. Unit Statuses (inside the manifest)

**Generated by:** `src/score/` — the test scorer

**Input:** The units list (all GAP) + every `*.test.tsx` file

**Process (three signals per test file):**

```
Signal 1 — Filename:
  SignInPage.test.tsx → baseName = "SignInPage"
  Find surfaces where component = "SignInPage" → surface.signin ✓

Signal 2 — MockClient setup:
  new MockClient({ profile: null }) → pre.unauthed, confident=true

Signal 3 — Test name/body keywords:
  "renders correctly" → beh.renders
  "shows validation error" → beh.form-validation-error

Result:
  unit.signin.unauthed.renders          → COVERED
  unit.signin.unauthed.form-validation-error → COVERED
  (other signin units stay GAP)
```

**Why auto-generated:** It would be impossible to manually track which of 556 units is covered by which of hundreds of test files. The scorer does this mechanically.

---

### 2e. Regression Flags (inside the manifest)

**Generated by:** `src/score/regression-detector.ts`

**Input:** Previous manifest + current manifest

**Output:** Units whose status went from COVERED → GAP are upgraded to REGRESSION

```
Previous scan:   unit.signin.unauthed.renders = COVERED
Current scan:    unit.signin.unauthed.renders = GAP  (test was deleted!)

Result:          unit.signin.unauthed.renders = REGRESSION
```

**Why auto-generated:** Regressions are a comparison — you can't know something regressed without comparing to the past. The harness does this automatically on every scan.

---

### 2f. `coverage.manifest.yaml` — The Central State File

**Generated by:** `harness scan` (or the scan step inside `close`/`loop`)

**Contains everything above:** surfaces, preconditions (seeds + auto-discovered), behaviors (from BEHAVIORS array), units (with computed statuses)

**Overwrites itself every scan.** The previous version is saved as `coverage.manifest.previous.yaml` before overwriting.

**Why auto-generated:** The manifest is a snapshot of current reality. It's not authored — it's derived. Editing it by hand would be overwritten on the next scan anyway.

---

### 2g. `reports/scan-<timestamp>.md`

**Generated by:** `src/report/scan-report.ts` after every `harness scan`

**Contains:**
- Coverage % (covered / total non-ignored units)
- Count of GAPs and REGRESSIONs by priority (P0/P1/P2)
- Table of new/retired/regression unit IDs
- Sample list of the worst P0 gaps

**Why auto-generated:** This is the human-readable summary of the manifest — the same data in prose form.

---

### 2h. `reports/close-<timestamp>.md`

**Generated by:** `src/report/close-report.ts` after every `harness close`

**Contains:**
- Which gap was picked, and why (strategy)
- Agent outcome (success / failure)
- The generated test file contents (verbatim)
- Verify outcome (if `--verify` was used)
- Delta: how many units changed status

---

### 2i. `reports/loop-<timestamp>.md` + `iteration-log.json`

**Generated by:** `src/report/loop-report.ts` + `src/loop/iteration-logger.ts`

**`iteration-log.json`:** Appended after every iteration (running tally). Contains raw data: timestamps, gap IDs, outcomes, deltas.

**`loop-<timestamp>.md`:** Written once at the end. Human-readable summary: configuration, per-iteration table, aggregate stats, and an explanation of why the loop stopped.

---

## Section 3: What CLAUDE Generates

Claude has exactly one output: **test files** written into the medplum repo.

---

### 3a. Test Files — `medplum/packages/app/src/**/*.beh.*.test.tsx`

**Generated by:** Claude, when invoked by `harness close` or `harness loop`

**Location:** ALWAYS inside the medplum repo, never in the harness repo

**Naming convention:**
```
packages/app/src/<path>/<ComponentName>.<behavior-id>.test.tsx

Examples:
  packages/app/src/SignInPage.beh.form-validation-error.test.tsx
  packages/app/src/admin/SuperAdminPage.beh.audit-event-emitted.test.tsx
  packages/app/src/lab/LabPage.beh.list-displayed.test.tsx
```

**Claude's inputs at generation time:**
```
1. The rendered prompt (from close-gap.md with all placeholders filled)
   → tells Claude: which surface, which precondition, which behavior

2. The mock setup snippet (from mock-setups.md or inline)
   → tells Claude: exactly how to set up MockClient

3. The behavior assertion guidance (from behavior-assertions.md)
   → tells Claude: what to assert in the test

4. The agent-context CLAUDE.md overlay
   → tells Claude: medplum testing conventions (how AppRoutes, render utils work)
```

**What the harness does NOT trust Claude about:**
- Which file to write to (the fence enforces this independently)
- Whether the test is correct (the re-scan checks this mechanically)

**Why Claude does this part:** Writing valid TypeScript Jest tests requires understanding code patterns, imports, and testing conventions. This is the one task that genuinely requires language model capability — everything else in the system is deterministic.

---

## Summary Table

| What | Who creates it | When | Changes when... |
|------|---------------|------|----------------|
| `harness.config.json` | You (via `init`) | Once | You move repos |
| `prompts/close-gap.md` | You | Once | You change Claude's instructions |
| `prompts/mock-setups.md` | You | Once | You add/change seed preconditions |
| `prompts/behavior-assertions.md` | You | Once | You refine assertion guidance |
| `agent-context/` files | You | Once | You change Claude's sandbox rules |
| 10 behaviors (in code) | You | Once | You add/remove a behavior verb |
| Category whitelist (in code) | You | Once | You change which behaviors apply to which pages |
| 5 seed preconditions (in code) | You | Once | You add a new standard MockClient pattern |
| Route categorization rules (in code) | You | Once | Medplum fundamentally restructures its routes |
| Keyword patterns (in code) | You | Once | You want to recognize new test name patterns |
| **Surfaces list** | **Harness** | **Every scan** | **Medplum adds/removes routes** |
| **Auto-discovered preconditions** | **Harness** | **Every scan** | **New MockClient patterns appear in tests** |
| **Units list** | **Harness** | **Every scan** | **Surfaces or preconditions change** |
| **Unit statuses (COVERED/GAP/etc.)** | **Harness** | **Every scan** | **Tests are added or deleted** |
| **Regression flags** | **Harness** | **Every scan** | **Previously-covered tests disappear** |
| **`coverage.manifest.yaml`** | **Harness** | **Every scan** | **Anything above changes** |
| **`reports/scan-*.md`** | **Harness** | **Every scan** | New file each time |
| **`reports/close-*.md`** | **Harness** | **Every close** | New file each time |
| **`reports/loop-*.md`** | **Harness** | **End of loop** | New file each time |
| **`iteration-log.json`** | **Harness** | **During loop** | Appended each iteration |
| ***Test files (.test.tsx)*** | ***Claude*** | ***Every close*** | ***Claude writes a new test each time*** |

---

## The Key Insight: Why This Split?

```
Hardcoded = things that require human judgment about meaning
                ("what does 'covered' mean for a healthcare app?")

Auto-generated = things that are a mechanical consequence of the app's state
                ("which routes exist? which tests cover them?")

Claude-generated = things that require language understanding
                ("write valid TypeScript that tests this specific scenario")
```

The system is designed so that **as the medplum app grows** (new routes, new tests):

- You don't need to update anything hardcoded
- The harness automatically discovers the new surfaces and preconditions
- The harness automatically detects the new coverage gaps
- Claude fills the gaps on demand

The only time you edit something hardcoded is when you change the **rules of what counts** (e.g., adding a new behavior verb, updating assertion guidance) — not when the app itself changes.
