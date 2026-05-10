---
description: Run harness scan against the configured target and surface the headline counts.
---

Run a fresh coverage scan against the target medplum checkout and surface the result.

Steps:

1. Run `./bin/run.js scan` and capture stdout. If it fails, print the error and stop.
2. Read the latest report under `reports/scan-*.md` and show me:
   - The Headlines section (gap counts by priority, regressions, new, retired)
   - The Status × Priority table
3. If regressions > 0, also list the first 10 regression unit ids from the report.
4. If new units > 0, briefly summarize what categories of units appeared (auth, admin, resource detail, etc.) — useful to confirm the change matches what was intended.

Do not modify any files; this is a read-only inspection.
