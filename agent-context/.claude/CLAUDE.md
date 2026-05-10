# Agent runtime context

You are being invoked headlessly by the medplum-coverage-harness to write
**one** Jest test file that closes a single coverage gap. The full prompt the
harness rendered describes the gap. This file provides additional ambient
context so you don't need to be told it every time.

## Your job, restated

Write exactly one test file. Do not modify anything else.

- The test file's path is named in the prompt under "File path:" and is
  enforced by a hook (see [hooks/pre-write-fence.sh](hooks/pre-write-fence.sh)).
  Writes to other paths are rejected before they happen — there's no clever
  workaround, just write the right path.
- The test does not need to pass on first try. It DOES need to compile, set
  up `MockClient` matching the named precondition, render the surface
  component, and assert on the named behavior.

## Tools you have

Only `Write`. Bash, Edit, Read, Glob, Grep are denied via
[settings.json](settings.json). If the task seems to require reading other
files first, you do not have enough context — write the most reasonable test
you can given the prompt and stop.

## How medplum tests work (the patterns to follow)

- Render via the existing helper at `packages/app/src/test-utils/render`
  if present; the import looks like:
  `import { render, screen, fireEvent, act } from './test-utils/render';`
  (Adjust the relative path for your file's location.)
- Tests render `<AppRoutes />` inside `<MemoryRouter>` and `<MedplumProvider
  medplum={...}>` rather than rendering the surface component in isolation.
  This is the medplum convention; follow it.
- For `MockClient` setup:
  - `pre.unauthed`: `new MockClient({ profile: null })`
  - `pre.practitioner.empty`: `new MockClient()` (the default profile is a
    practitioner) or `new MockClient({ profile: DrAliceSmith })`
  - `pre.practitioner.with-patient`: practitioner profile + a
    `medplum.createResource({ resourceType: 'Patient', ... })` call before
    render
  - `pre.admin.*`: practitioner profile + `medplum.setActiveLoginOverride(...)`
    with admin claims
- Imports: prefer named imports from `@medplum/mock`, `@medplum/react`,
  `react-router`. Don't add new dependencies.

## Healthcare behavior assertions (when applicable)

- `beh.phi-masked`: render with a Patient containing a name/MRN/birthDate.
  Assert those fields are absent (or rendered as a redaction marker) when
  the active role isn't cleared. The flip-side test (authorized role sees
  the values) belongs in a sibling unit, not this one.
- `beh.audit-event-emitted`: spy on `medplum.createResource`. Trigger the
  audit-relevant action. Assert the spy received a call with
  `resourceType: 'AuditEvent'` and the expected `agent.who` reference.
- `beh.consent-honored`: seed a `Consent` resource that restricts the
  Practitioner via `provision.actor`. Render the surface. Assert the
  protected fields are withheld OR an explicit "consent restricts access"
  notice is present.

## Output

Output ONLY the file contents via the `Write` tool. No commentary, no
markdown fences, no explanation. The harness reads the file from disk
afterwards.
