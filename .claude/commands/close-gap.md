---
description: Close a single coverage gap end-to-end (scan → close → report) for a specific unit id or via strategy.
---

Close one coverage gap end-to-end.

Arguments (the user supplies one of):

- A specific unit id like `unit.signin.unauthed.form-validation-error`
- A strategy: `highest-priority`, `regression-first`, `fewest-deps`, `random`

If the user gave neither, default to `--strategy highest-priority`.

Steps:

1. If a unit id was provided, run `./bin/run.js close --gap <id> --verify`.
   Otherwise run `./bin/run.js close --strategy <strategy> --verify`.
2. Show the user:
   - The agent outcome (success / failure) and reason if failure.
   - The verify outcome (compile-ok-tests-pass / compile-ok-tests-fail / compile-failed).
   - The before/after status of the targeted unit.
   - The path to the generated test file under `../medplum/packages/app/src/`.
   - The path to the generated `reports/close-*.md`.
3. If the agent failed, do NOT retry — the harness's failure-cap logic is the
   right place for that. Just surface the reason.
4. If verify hit `compile-failed`, that counts toward the loop's failure cap;
   call this out explicitly.

Do not edit harness code, prompts, or the manifest. This is a single
iteration of the closed loop, nothing more.
