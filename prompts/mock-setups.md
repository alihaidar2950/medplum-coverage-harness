# MockClient setup snippets, keyed by precondition id

Each entry is a TypeScript snippet that the prompt builder splices into
`{{precondition.mock_setup_snippet}}`. These five seeds cover the auth/role
matrix the harness emits by default. Auto-discovered preconditions
(synthesized from observed test patterns by `discover/mock-catalog.ts`) carry
their snippet inline on the precondition record and bypass this file.

## pre.unauthed

```ts
import { MockClient } from '@medplum/mock';
// Unauthenticated MockClient — no signed-in user.
const medplum = new MockClient({ profile: null });
```

## pre.practitioner.empty

```ts
import { DrAliceSmith, MockClient } from '@medplum/mock';
// Practitioner signed in via the default mock profile, no FHIR resources seeded.
// MockClient defaults to a practitioner profile when no `profile` is passed,
// but DrAliceSmith is the canonical fixture used elsewhere in packages/app/src.
const medplum = new MockClient({ profile: DrAliceSmith });
```

## pre.practitioner.with-patient

```ts
import { DrAliceSmith, MockClient } from '@medplum/mock';
// Practitioner signed in + one Patient seeded for list/detail surfaces.
const medplum = new MockClient({ profile: DrAliceSmith });
await medplum.createResource({
  resourceType: 'Patient',
  name: [{ given: ['Test'], family: 'Patient' }],
});
```

## pre.admin.empty

```ts
import { DrAliceSmith, MockClient } from '@medplum/mock';
// Project admin signed in, no project resources seeded.
// Pattern: start from a practitioner profile, then upgrade the active login
// to admin via setActiveLoginOverride — this is what packages/app/src/admin
// tests use today.
const medplum = new MockClient({ profile: DrAliceSmith });
medplum.setActiveLoginOverride({
  accessToken: 'fake',
  refreshToken: 'fake',
  profile: { resourceType: 'ProjectMembership', admin: true } as any,
});
```

## pre.admin.with-project

```ts
import { DrAliceSmith, MockClient } from '@medplum/mock';
// Project admin signed in + one Project seeded.
const medplum = new MockClient({ profile: DrAliceSmith });
medplum.setActiveLoginOverride({
  accessToken: 'fake',
  refreshToken: 'fake',
  profile: { resourceType: 'ProjectMembership', admin: true } as any,
});
await medplum.createResource({ resourceType: 'Project', name: 'Test Project' });
```
