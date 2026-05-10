# Interview Q&A — Likely Head of Engineering Questions

This document anticipates the questions a Head of Engineering at a healthcare-AI
company is likely to ask after reviewing this take-home, and answers them as
candidly as possible — including the answers that don't flatter the work.

It is organized as the questions might come up in a 45-minute conversation:
architecture first, then trust/quality, then operations, then healthcare
specifics, then maintenance, then the skeptical edge cases. A final section
collects what I'd change if starting over.

---

## 1. Architecture & Design

### Q1. Why model coverage as `(Surface, Precondition, Behavior)` instead of just files or routes?

The brief asked us to invent a vocabulary that models *what the app does*, not
*what code exists*. A file-based model says "SignInPage.tsx has 70% line
coverage" and tells you nothing about whether the unauthenticated case is
tested. The triple decomposes coverage along the three axes that actually
matter to a user: **which page**, **what state**, **what assertion**.

The non-obvious payoff is that gaps become *generative*. If `/signin` exists
and `pre.unauthed` exists and `beh.form-validation-error` exists, then a unit
exists — even if no test does. That gap is something the harness can act on,
and the agent has enough structure to write a sensible test for it.

### Q2. Why is `MockClient` setup a coverage axis instead of a fixture detail?

Because the brief explicitly elevated it ("MockClient is the seam"), and
because the same React component behaves *completely differently* depending on
what FHIR data is in the mock. A `PatientPage` with one Patient and a
`PatientPage` with zero Patients are two different code paths. Treating mock
setup as invisible would mean we'd say `PatientPage.test.tsx` is COVERED when
it's only covering the populated case.

The cost is that the precondition catalog has to stay in sync with the
codebase. We address that with auto-discovery (see Q12).

### Q3. Why oclif rather than a 30-line `commander` CLI?

Oclif gives us typed flags, generated `--help`, plugin architecture, and a
tested command lifecycle for free. The harness has four commands today and
would plausibly grow to seven or eight (`harness ignore`, `harness report`,
`harness diff`). A bare `commander` script becomes unmaintainable around
command #5; oclif scales gracefully.

There is a counter-argument: oclif's class-based API is heavier than
`commander`'s functional one, and for a take-home, it's overkill. I picked it
deliberately because the brief asked for something that could plausibly grow
into a real tool, and that means picking the framework that doesn't need to be
ripped out at the first scale boundary.

### Q4. Why ts-morph rather than `@typescript-eslint/parser` or regex?

Regex would fail on multi-line JSX and conditional `<Route>` rendering, and
both occur in `AppRoutes.tsx`. `@typescript-eslint/parser` returns an AST but
no convenient walker. ts-morph gives us `forEachDescendant`, `getDescendantsOfKind`,
and the ability to refresh a single source file from disk between scans —
which we use in [src/score/test-parser.ts](../src/score/test-parser.ts) so the
re-scan after a `close` doesn't re-parse the entire `packages/app/src` tree.

### Q5. Why is the agent constrained at the OS/tool layer instead of in the prompt?

Because prompt instructions are a soft constraint and `claude` does not always
follow them. The agent overlay at
[agent-context/.claude/](../agent-context/.claude/) does three things the
prompt cannot:
1. `settings.json` allowlists only the `Write` tool.
2. `pre-write-fence.sh` rejects any `Write` whose `file_path` doesn't match
   the `EXPECTED_TEST_FILE` env var the harness sets before spawning Claude.
3. `--add-dir agent-context` is the only way Claude sees those settings.

This is the difference between "we asked the agent nicely" and "the agent
literally cannot write outside the box, regardless of what the prompt says."
For an autonomous loop running unattended, that's a non-negotiable property.

---

## 2. Trust & Quality

### Q6. How do I know the COVERED count isn't lying?

You don't, fully — and I want to be explicit about that. A unit is COVERED
when (a) a test file's basename matches the surface component, and (b) the
test's MockClient setup classifies confidently into a known precondition. The
matcher does *not* check whether the test actually asserts the behavior.

Four mitigations:

1. **`gapClosed` (added during self-review).** The `close` CLI exits 2 if
   the agent wrote a file but the targeted unit isn't COVERED in the
   post-rescan. So "agent succeeded" and "gap closed" are now distinct
   signals. See §7.2 below for the full bug-and-fix record.
2. **`--verify` runs Jest** on each generated test. A test that doesn't even
   compile cannot have written a real assertion. This catches the worst
   class of fake.
3. **The headline metric is delta**, not absolute %. Systematic matcher
   errors cancel out across before/after, so even if our scorer is too
   generous, "+5 COVERED after this loop run" is still a meaningful number.
4. **PARTIAL exists.** When the matcher can't classify the precondition
   confidently, the unit goes to PARTIAL, not COVERED. I deliberately
   resisted promoting PARTIAL→COVERED to make headline numbers look better.

What's still missing is mutation testing (§11.3 of design.md): a unit-test
that always passes regardless of implementation gets credit today. Adding a
mutation oracle would close that loophole.

### Q7. What stops the loop from happily writing 50 useless tests in a row?

Quality-decay detection. When `--verify` is on, the loop watches the last 5
verified tests; if fewer than 50% compiled cleanly, it stops and tells you.
See [src/loop/stopping-conditions.ts](../src/loop/stopping-conditions.ts).

But this is a coarse signal — it catches "the agent is broken," not "the
agent is producing trivially-passing tests." A test that asserts
`expect(true).toBe(true)` will look successful to the quality detector while
being completely useless. For that case I rely on (a) human review before
merge and (b) the future mutation oracle.

### Q8. The behavior classifier is regex-based. What happens when a test name doesn't match any keyword?

The unit gets no behavior credit beyond `beh.renders` (which we award to any
test file with at least one `test()` block). So we under-count COVERED on the
margin — which I think is the right failure mode. Generous matchers create
silent false confidence; our matcher is conservative by design.

The keyword list in
[src/score/unit-matcher.ts](../src/score/unit-matcher.ts) is hand-tuned, with
healthcare patterns checked before generic ones (`AuditEvent` beats `submit`
when both match). A real production version would either (a) require a
naming convention enforced by ESLint, or (b) train a small classifier on
test name → behavior. I didn't do either; the regex approach is a
defensible 80/20.

### Q9. The healthcare behaviors are in the vocabulary but lightly exercised. Is that a real gap or a documentation issue?

Real gap. We have:
- 10 behaviors in the enum (3 healthcare-specific) ✅
- Keyword patterns to classify them in `unit-matcher.ts` ✅
- An end-to-end test
  ([tests/healthcare-loop.test.ts](../tests/healthcare-loop.test.ts))
  proving the close→re-scan cycle moves a `beh.audit-event-emitted` unit
  GAP→COVERED with a stubbed agent ✅

What we don't have are *assertion libraries* for these behaviors. A test
classified as `beh.phi-masked` today only needs to mention "phi" or "masked"
— there's no validator that checks the rendered output actually redacted
specific fields. That would be the next chunk of work for a real deployment
in healthcare: per-behavior assertion helpers that turn the keyword into a
real compliance check.

### Q10. How does this differ from what `jest --coverage` already gives us?

`jest --coverage` measures *code execution*, not *user scenarios*. A test
that calls `render(<SignInPage />)` and asserts nothing produces 100% line
coverage on `SignInPage.tsx`. Our model wouldn't count it as COVERED for any
particular behavior. That said, line/branch coverage is a valid input — a
mature version of this harness would consume both: our triple model for *what
to test*, and jest --coverage for *how thoroughly the test exercises the
code*. They're orthogonal.

---

## 3. Operations & Cost

### Q11. What does it cost to run `harness loop --until p0-gaps==0` to completion against medplum/main?

There are 40 P0 gaps as of today's scan. Each iteration sends roughly 3-5K
tokens of input (prompt template + mock snippet + assertion guidance) and
receives 1-2K tokens of output (the test file). Using Claude Sonnet pricing
(approx $3/MTok input, $15/MTok output), one iteration is ~$0.04, so 40
iterations ≈ **$1.60**.

The bigger cost is wall-clock: ~30-60 seconds per iteration including the
agent call and the re-scan, so ~25-40 minutes for a full P0 sweep. The
30-minute budget guardrail will probably truncate it; you'd run it overnight
or split across two invocations. Real-world cost is bounded by the budget
and iteration caps, both of which are configurable but not removable.

### Q12. How does this stay in sync when the medplum app changes weekly?

Three mechanisms:

1. **Surfaces** are re-discovered on every scan from `AppRoutes.tsx`. New
   routes appear automatically; deleted routes become "retired units" in the
   regression report.
2. **Preconditions** are partially auto-discovered. The 5 hand-curated seeds
   are the bootstrap; the catalog also walks every existing test file and
   synthesizes a new precondition any time it sees an unfamiliar MockClient
   pattern. See
   [src/discover/mock-catalog.ts](../src/discover/mock-catalog.ts).
3. **Regression detection** preserves the previous manifest as
   `coverage.manifest.previous.yaml` and flags `COVERED→GAP` transitions as
   `REGRESSION` in the next scan. So if a developer deletes a test, the next
   scan surfaces it.

What is *not* automated: the behavior enum, route categorization rules, and
prompt templates. Those need human edits when the app's vocabulary shifts.
That's intentional — see Q1 — but it's a maintenance cost.

### Q13. How would you wire this into CI?

`.github/workflows/coverage-scan.yml` already does it: on every PR touching
the harness, the workflow checks out medplum/main, runs `./bin/run.js scan`
against it, captures the report, and posts it as a PR comment (with
`--edit-last` to avoid duplicate comments on re-runs). It's
non-blocking — the scan never fails the PR.

For medplum's own repo, you'd flip it: run the harness as a workflow on every
medplum PR, and surface (a) regressions as a blocking check and (b) gap
counts as a non-blocking comment. The `harness close` command would *not* run
in CI — that's reserved for `harness loop` invoked manually or on a
schedule, because an LLM call inside CI on every commit is too expensive.

### Q14. What's the incident-response if `claude` starts producing nonsense?

Three layers of defense:

1. The **path fence** stops the agent from corrupting any file other than
   the one expected test file. A misbehaving agent can produce a bad test;
   it cannot rm -rf the repo.
2. The **failure cap** (default 3 consecutive) stops the loop after three
   bad agent invocations.
3. The **quality-decay gate** stops the loop if compile success rate drops
   below 50% over the last 5 verified iterations.

In a real incident, you'd `git revert` the harness-generated commits — the
naming convention `<Component>.beh.<id>.test.tsx` makes them grep-able.
There's no shared state corruption to recover from.

---

## 4. Healthcare & Compliance

### Q15. Do any test fixtures touch real PHI?

No. Every fixture is synthetic. The MockClient is from `@medplum/mock`, which
ships canned profiles like `DrAliceSmith` and never makes real API calls.
The harness never touches the medplum *server* — only the app's frontend
code, which is wired through `MedplumProvider` to the in-memory MockClient
during tests. The seam is by design: there is no HIPAA-relevant data
anywhere in the test path.

### Q16. What about prompts sent to Anthropic? Does any patient-shaped data leak?

The prompt builder
([src/close/prompt-builder.ts](../src/close/prompt-builder.ts)) splices in
`surface.route`, `precondition.description`, `behavior.description`, and the
mock setup snippet. None of these contain PHI — they contain things like
`/signin`, "unauthenticated MockClient", and code snippets like
`new MockClient({ profile: null })`. The agent never sees medplum source
code; it only sees the structured gap description.

If the harness were extended to include source-code context (e.g., paste in
the contents of `SignInPage.tsx` to give Claude better context), we'd need
to audit that source for any baked-in test data. Today the path doesn't
include source code.

### Q17. How would you handle audit logging for the agent's actions?

Today: every `close` writes `reports/close-<timestamp>.md` with the full
prompt, the agent's exit status, the generated test path, and the verify
outcome. Every `loop` writes `reports/iteration-log.json` with a
machine-readable record per iteration. Both are gitignored by default
because they're per-run, but you'd commit them in a regulated environment.

For real compliance, you'd also want: the literal stdout/stderr of each
`claude` invocation captured (we drain it but don't persist), a hash of the
prompt template version, and a hash of the agent-context overlay. None of
that is hard — it's a one-day add when the requirement appears.

### Q18. Three of the ten behaviors are healthcare-specific. Why those three?

`phi-masked`, `audit-event-emitted`, `consent-honored` are the three places
healthcare apps fail compliance audits, in my reading. PHI exposure to
unauthorized users is the most catastrophic class of bug; missing
AuditEvents make breach investigations impossible; ignoring Consent
restrictions is both a legal and ethical failure. The remaining seven are
generic UI verbs because medplum is a UI framework, but the healthcare three
are deliberately first-class — they'd be the first to get assertion
libraries (Q9) in a real deployment.

---

## 5. Maintenance & People

### Q19. Who maintains this on a team where the SDET who wrote it leaves?

The harness has three points where domain knowledge lives:

1. **`prompts/behavior-assertions.md`** — what each behavior means, in
   plain English. This is the easiest to maintain; it's just markdown and
   any engineer who understands the codebase can edit it.
2. **`src/discover/index.ts` → `categorizeRoute()`** — the URL → priority
   mapping. This is hand-coded but small (~30 lines). A new SDET would learn
   it in 15 minutes.
3. **`src/score/unit-matcher.ts` → `classifyBehavior()`** — the keyword
   regex list. The most fragile piece; needs hand-tuning when test naming
   conventions evolve. A team would need to commit to updating this.

The auto-discovered precondition catalog is the *least* maintenance burden —
it self-syncs when developers add tests. The hand-curated seeds rarely change.

### Q20. How does a new engineer onboard to this codebase?

Read in order:
1. [docs/HOW_IT_WORKS.md](./HOW_IT_WORKS.md) — plain English, ~30 min read.
2. [docs/INPUTS_AND_OUTPUTS.md](./INPUTS_AND_OUTPUTS.md) — what's hardcoded
   vs auto-generated, ~15 min.
3. [docs/design.md](./design.md) — the architectural source of truth, ~45 min.
4. Run `./bin/run.js scan` against medplum locally. Open the report.
5. Read [src/discover/index.ts](../src/discover/index.ts) and
   [src/score/unit-matcher.ts](../src/score/unit-matcher.ts). That's 80%
   of the system.

Total onboarding: half a day to be useful, two days to be productive.

### Q21. What's the failure mode if the harness's own assumptions about medplum break?

The harness assumes `packages/app/src/AppRoutes.tsx` exists and contains a
`<Routes>` block with `<Route path=... element=...>` children. If medplum
restructures (e.g., adopts file-system routing), `discoverSurfaces()` returns
an empty array, the manifest has zero surfaces, and the scan reports zero
units. That's a loud failure, not a silent one.

The harness also assumes test files live at `packages/app/src/**/*.test.tsx`
and use the `@medplum/mock` MockClient. Either change would break the
matcher. Both are stable enough to bet on; if they shifted, the matcher
needs ~50 lines of update and a new fixture set.

---

## 6. The Skeptical Questions

### Q22. Isn't this just `jest --coverage` with extra steps?

No, but I understand why the question gets asked. `jest --coverage` answers
"which lines ran?" — a useful question for finding *unreachable code*. This
harness answers "which user scenarios are tested?" — a different question
entirely. They're complementary, not redundant.

The clearest demonstration: a test that calls
`render(<PatientPage />)` and never asserts anything will give you 100% line
coverage on PatientPage.tsx. Our matcher gives it `beh.renders` only, and
classifies eight other PatientPage units as `GAP`. The two views disagree,
and the disagreement is informative.

### Q23. You're using an LLM to write tests for an LLM-adjacent codebase. Isn't that turtles all the way down?

Three points:

1. The LLM is *constrained* — it can write exactly one test file at a path
   the harness picks, with tools restricted to `Write` only. It is not
   evaluating its own output.
2. The harness is the *intelligence layer*. It picks gaps via a strategy,
   builds prompts from a template, and validates the output (file presence,
   compile success). The LLM is the executor.
3. Yes, this would compose poorly with itself — using the harness to test
   the harness would be circular. The harness's own tests
   ([tests/](../tests/)) are hand-written Vitest tests. There are 137 of
   them.

### Q24. The 511 GAPs your scan finds — do they actually matter, or are most of them artifacts?

A bit of both. The 40 P0 gaps (auth, OAuth, signup, password reset) are
unambiguously real and should be closed. The 226 P1 gaps (clinical surfaces)
are mostly real but include some "list-displayed on a page that doesn't show
a list" — which is a category-whitelist failure on my side. The 245 P2 gaps
include true artifacts: admin pages we may not actually need to test
exhaustively, debug routes, etc.

A more honest top-line metric is "**P0 gaps closed**" rather than "total
gaps." The P0 number is small, well-defined, and clearly actionable; the
total is inflated by the Cartesian-product nature of the model. I'd update
the scan report to lead with P0 only.

### Q25. If I deployed this to production tomorrow, what breaks first?

Three things, in order of likelihood:

1. **Behavior keyword classifier** misses tests that don't follow naming
   conventions. Result: under-count of COVERED, over-count of PARTIAL.
   *This is the failure mode the existing matcher is most exposed to.*
2. **`AppRoutes.tsx` parser** breaks on a JSX pattern I didn't anticipate
   (e.g., a route map built from a `.map()` over an array). Result: missing
   surfaces, possibly silent.
3. **Agent-context overlay** stops being honored if the `claude` CLI's
   settings format changes. The fence script wouldn't run; the agent could
   write anywhere. *This is the worst failure but also the least likely.*

What I'd do before deploying: write a smoke test that runs `harness scan` in
CI weekly and alerts on >10% week-over-week change in the surface or unit
count — that's the canary for "something I'm assuming about medplum has
changed."

---

## 7. Control-Path Bugs Found in Self-Review (and Fixed)

A stricter pass through the source after the rest of this doc was written
turned up three control-path issues where the implementation didn't match
the documented semantics. I fixed them in [src/score/index.ts](../src/score/index.ts),
[src/commands/close.ts](../src/commands/close.ts),
[src/commands/loop.ts](../src/commands/loop.ts),
[src/loop/index.ts](../src/loop/index.ts), and
[src/close/index.ts](../src/close/index.ts). The full record:

### 7.1 Regression detection wasn't wired into close/loop

**Symptom:** `score/index.ts` `scan()` returned the bare `discover + scoreUnits`
result. Only `commands/scan.ts` wrapped it with `detectRegressions`. The
`close` and `loop` paths used the bare function — so the units they iterated
on never had `status === 'REGRESSION'`. That made:

- `--strategy regression-first` fall back to highest-priority silently (no
  REGRESSION units to pick).
- `--until regressions==0` trivially true on every loop run.

**Fix:** Added `scanWithRegressions()` in `src/score/index.ts`. It reads the
on-disk manifest (or accepts an injected `previous`), runs the bare scan,
and tags REGRESSION before returning. Wired it into `commands/scan.ts`,
`commands/close.ts`, and the loop's defaultDeps. Test:
[tests/score.test.ts](../tests/score.test.ts) — the new
"scanWithRegressions" describe block builds a temp target with no test file,
provides a `previous` where the unit was COVERED, and asserts the unit comes
back as REGRESSION.

### 7.2 `close` reported success even when the gap wasn't closed

**Symptom:** `closeOne` set `agentOutcome='success'` whenever the agent
landed a file at the expected path. The CLI exit code keyed off
`agentOutcome` only, so a syntactically valid test the matcher couldn't
classify confidently (e.g. bare `new MockClient()` → PARTIAL) still produced
exit 0. The brief is about closing gaps, not producing files; this was a
real correctness gap.

**Fix:** Added a `gapClosed: boolean` field to `CloseOutcome`. It's set to
`(after.units.find(u => u.id === unit.id)?.status === 'COVERED')`. The CLI
now exits 2 (the documented-but-unimplemented "produced test did not match
the gap" code) when `agentOutcome === 'success'` but `gapClosed === false`.
Test:
[tests/healthcare-loop.test.ts](../tests/healthcare-loop.test.ts) — the new
counter-test stubs the agent to write a bare-`MockClient` test, asserts
`agentOutcome === 'success'`, `afterUnit.status === 'PARTIAL'`, and
`gapClosed === false`.

### 7.3 The loop bypassed `validatePromptReferences`

**Symptom:** Both `commands/scan.ts` and `commands/close.ts` called
`validatePromptReferences` to fail fast on dangling prompt anchors, but
`commands/loop.ts` went straight to `runLoop` without it. If anchors had
drifted, every loop iteration would silently splice the
`// TODO: snippet missing` placeholder into the agent's prompt — the loop
wouldn't error, it would just churn out useless tests until a guardrail
fired. CLAUDE.md lists ref validation as a load-bearing invariant; the loop
violated it.

**Fix:** `commands/loop.ts` now runs `scanWithRegressions` + `validatePromptReferences`
up-front and throws before calling `runLoop` if any ref is bad.
[tests/refs.test.ts](../tests/refs.test.ts) already covers the validator
itself; the wiring change is straightforward enough that the surrounding
code review carries it.

---

## 8. What I'd Still Change If Starting Over

Items below survived the control-path fix pass — they're real model-quality
concerns, not bugs:

1. **Add the mutation oracle from day one.** Even with `gapClosed`, COVERED
   means "matcher saw a structurally-plausible test", not "test catches
   bugs." Mutation testing (§11.3 of design.md) would close that gap.
2. **Per-behavior assertion helpers.** `expect.toHaveAuditEvent(spy, …)`
   would let `beh.audit-event-emitted` mean something stronger than "the
   word AuditEvent appears."
3. **Drop the keyword classifier**, replace with a file-naming convention
   enforced by ESLint (`SignInPage.beh.form-validation-error.test.tsx`).
   Cleaner, deterministic, and self-documenting.
4. **Surface match should fall back to `importedComponents`.** Today
   [src/score/unit-matcher.ts](../src/score/unit-matcher.ts) only matches by
   filename basename. The parser already extracts named imports — using
   them as a secondary signal would catch tests that wrap rendering in
   helpers.
5. **Auto-precondition fan-out is too loose.** A new observed practitioner
   signature gets paired with every practitioner-auth surface in
   [src/discover/index.ts](../src/discover/index.ts). A real fix would
   gate fan-out on which surfaces actually use the seeded resources.
6. **Retry-with-feedback** in the agent invoker. One bad attempt kills the
   iteration today. Real version: feed the Jest stderr back into the next
   prompt, up to N attempts per gap.
7. **Lead the report with P0**, not totals. P2 inflation makes top-line
   numbers hard to read.
8. **Playwright matcher** for runner-agnostic coverage of integration
   scenarios.

---

*Last updated for the fix-the-three-control-path-bugs revision (139/139
tests). If a question turns out to require a code walkthrough I didn't
anticipate, the file-and-folder map in
[HOW_IT_WORKS.md §12](./HOW_IT_WORKS.md#12-file-and-folder-map) is the map.*
