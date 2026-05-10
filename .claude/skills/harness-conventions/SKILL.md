---
name: harness-conventions
description: Apply when editing the medplum-coverage-harness — schema, scoring, close orchestration, loop, or the manifest catalog. Encodes the invariants from CLAUDE.md so they're enforced at edit time, not just documented.
---

# Harness conventions

## When this skill applies

Editing any of:

- `src/schema/**` — Zod schemas, refs validator
- `src/score/**` — test parser, mock-call extractor, unit matcher
- `src/discover/**` — route walk, mock catalog, manifest assembly
- `src/close/**` — gap picker, prompt builder, agent invoker, verify
- `src/loop/**` — controller, stopping conditions, budget tracker
- `coverage.manifest.yaml` — the generated manifest itself
- `prompts/**` — close-gap template, mock-setups, behavior-assertions

## Hard rules

1. **Never bypass `parseManifest`.** All YAML reads go through
   `src/util/yaml.ts → readManifest`, which calls `parseManifest`, which
   validates schema + cross-refs. If you're tempted to read the YAML
   directly, you've found a layering bug.

2. **Never bypass `validatePromptReferences` in scan/close paths.** Both
   commands run it as a fail-fast preflight. If a new command surface needs
   the catalog, it needs this check too.

3. **Status merge: `COVERED > PARTIAL > GAP`.** Match the existing
   `STATUS_RANK` semantics in `src/score/index.ts`. Score never downgrades a
   unit; the strongest match wins.

4. **Behavior whitelist is per-category.** Adding a new behavior means
   updating: the Zod enum, the `BEHAVIORS` array in `discover/index.ts`,
   `BEHAVIORS_BY_CATEGORY` in the same file, and the corresponding
   `## <id>` section in `prompts/behavior-assertions.md`. All four. The
   prompt-ref validator catches the last one missing.

5. **Adding a new precondition** means: a new `## pre.<id>` section in
   `prompts/mock-setups.md` with a fenced code block, an entry in
   `discoverMockCatalog`, and (if it implies a new auth role) updates to
   `preconditionsForSurface`. Run the existing `tests/refs.test.ts` to
   confirm.

6. **Loop guardrails cannot be disabled.** Iteration cap, budget cap,
   failure cap, quality-decay are evaluated *before* user `--until`
   conditions. If a fix to `evaluateStoppingConditions` involves moving a
   guardrail check below a goal check, it's wrong.

## Layering

Modules form a strict acyclic graph:

```
util → schema → discover → score → close → loop
                                       ↘
                                    report/
```

A lower-layer module cannot import from an upper-layer one. If schema needs
a markdown reader, the reader lives in `util/`, not `close/`. The
`readSection` extraction into `util/markdown.ts` is the canonical example.

## Test discipline

- Every behavioral change has a test. If you can't test it, write it down in
  the PR/commit body so the reviewer knows.
- Vitest is for the harness's own tests; Jest is what the harness *invokes*.
  Don't import Jest internally.
- Tests live in `tests/` (excluded from `tsconfig.json`). Fixtures live in
  `tests/fixtures/`. Don't put fixtures under `src/`.

## When you're tempted to add a feature

The brief was 2 hours. If the design doc has a section in §11
(Limitations), that's a deliberate non-goal — adding it without flagging is
scope creep. Speak up first.
