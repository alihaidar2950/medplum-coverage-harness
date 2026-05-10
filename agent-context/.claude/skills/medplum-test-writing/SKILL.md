---
name: medplum-test-writing
description: Apply when writing a Jest test for a route in medplum/packages/app/src. Encodes the testing conventions used elsewhere in the codebase so generated tests match the existing style and the MockClient seam works correctly.
---

# Writing tests for medplum/packages/app/src

This skill is loaded when the harness invokes you to close a coverage gap.
The harness passes a specific (Surface, Precondition, Behavior) tuple in the
prompt; this skill is the surrounding convention library.

## Imports — the canonical set

```ts
import type { MedplumClient } from '@medplum/core';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './AppRoutes';
import { act, fireEvent, render, screen, waitFor } from './test-utils/render';
```

Adjust the relative paths (`./AppRoutes`, `./test-utils/render`) for your
file's location. If your test file is at `packages/app/src/admin/Foo.test.tsx`,
those become `../AppRoutes` and `../test-utils/render`.

If `test-utils/render` doesn't exist at the expected path, fall back to
`@testing-library/react` directly with `MedplumProvider` wrapping it.

## The setup function pattern

Every test file in `packages/app/src/` defines a local `setup()` helper that
encapsulates render + router + provider:

```ts
async function setup(
  url = '/the/route',
  medplum: MedplumClient = new MockClient()
): Promise<void> {
  await act(async () => {
    render(
      <MedplumProvider medplum={medplum}>
        <MemoryRouter initialEntries={[url]} initialIndex={0}>
          <AppRoutes />
        </MemoryRouter>
      </MedplumProvider>
    );
  });
}
```

Always render `<AppRoutes />` (the whole router), not the surface component
directly — that's the medplum convention and it's how the routes the test
exercises actually mount.

## MockClient cookbook (per precondition id)

### `pre.unauthed`

```ts
const medplum = new MockClient({ profile: null });
```

### `pre.practitioner.empty`

```ts
import { DrAliceSmith } from '@medplum/mock';
const medplum = new MockClient({ profile: DrAliceSmith });
```

(or bare `new MockClient()` — the default profile is a practitioner.)

### `pre.practitioner.with-patient`

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
await medplum.createResource({
  resourceType: 'Patient',
  name: [{ given: ['Test'], family: 'Patient' }],
});
```

### `pre.admin.empty`

```ts
const medplum = new MockClient();
medplum.setActiveLoginOverride({
  accessToken: 'fake',
  refreshToken: 'fake',
  profile: { resourceType: 'ProjectMembership', admin: true } as any,
});
```

### `pre.admin.with-project`

Same as `pre.admin.empty` plus a `medplum.createResource({ resourceType:
'Project', name: 'Test Project' })` call.

## Behavior assertion cookbook

### `beh.renders`

```ts
test('Renders', async () => {
  await setup();
  expect(await screen.findByRole('heading')).toBeInTheDocument();
});
```

Use `findByRole` (async) over `getByRole` for the first assertion to handle
suspense-loaded components.

### `beh.list-displayed`

```ts
expect(await screen.findByTestId('search-control')).toBeInTheDocument();
const rows = await screen.findAllByRole('row');
expect(rows.length).toBeGreaterThan(1); // header + at least one data row
```

### `beh.form-submit-success`

```ts
await act(async () => {
  fireEvent.change(screen.getByLabelText('Email *'), {
    target: { value: 'admin@example.com' },
  });
});
await act(async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
});
expect(await screen.findByTestId('search-control')).toBeInTheDocument();
```

### `beh.form-validation-error`

```ts
await act(async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
});
expect(await screen.findByText(/required|invalid/i)).toBeInTheDocument();
```

### `beh.empty-state`

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
// no resources seeded
await setup('/Patient', medplum);
expect(await screen.findByText(/no.*patients|empty/i)).toBeInTheDocument();
```

### `beh.error-state`

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
medplum.search = () => Promise.reject(new Error('boom'));
await setup('/Patient', medplum);
expect(await screen.findByRole('alert')).toBeInTheDocument();
```

### `beh.phi-masked`

```ts
// Render with a Patient containing PHI but a non-cleared role.
const medplum = new MockClient({ profile: /* role without PHI clearance */ });
await medplum.createResource({
  resourceType: 'Patient',
  name: [{ given: ['Phi'], family: 'Hidden' }],
  birthDate: '1980-01-01',
});
await setup('/Patient/<id>', medplum);
expect(screen.queryByText('1980-01-01')).not.toBeInTheDocument();
expect(screen.queryByText('Phi Hidden')).not.toBeInTheDocument();
```

### `beh.audit-event-emitted`

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
const spy = jest.spyOn(medplum, 'createResource');
await setup(/* the action route */, medplum);
// trigger the audit-relevant action
await act(async () => {
  fireEvent.click(screen.getByRole('button', { name: /save|delete/i }));
});
expect(spy).toHaveBeenCalledWith(
  expect.objectContaining({ resourceType: 'AuditEvent' })
);
```

### `beh.consent-honored`

```ts
const medplum = new MockClient({ profile: DrAliceSmith });
await medplum.createResource({
  resourceType: 'Consent',
  status: 'active',
  category: [{ coding: [{ code: 'restricted' }] }],
  provision: {
    actor: [
      // exclude the current Practitioner from access
      { role: { coding: [{ code: 'PRCP' }] }, reference: { reference: 'Practitioner/other' } },
    ],
  },
} as any);
await setup('/Patient/<id>', medplum);
// Either protected fields are absent, OR an explicit notice is rendered.
const notice = screen.queryByText(/consent.*restrict|access denied/i);
const phiAbsent = !screen.queryByText(/birthDate|name details/i);
expect(notice ?? phiAbsent).toBeTruthy();
```

## What NOT to do

- Do not import or call `jest.mock(...)` to stub modules — `MockClient`
  is the standard seam. Module-level mocks make the test brittle and
  inconsistent with the rest of the suite.
- Do not add new dependencies. The harness rejects PRs that touch
  `package.json`.
- Do not write multiple `describe` blocks in the same file. One file =
  one (Surface, Precondition, Behavior) tuple.
- Do not modify any other file. Hook-enforced.
