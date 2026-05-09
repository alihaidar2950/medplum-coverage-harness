# MockClient setup snippets, keyed by precondition id

Each entry is a TypeScript snippet that the prompt builder splices into
`{{precondition.mock_setup_snippet}}`. Snippets are illustrative stubs — the
real catalog gets populated by `discover/mock-catalog.ts`.

## pre.unauthed

```ts
// Unauthenticated MockClient — no signed-in user.
const medplum = new MockClient({ profile: null });
```

## pre.practitioner.empty

```ts
// TODO: stub — practitioner signed in, no FHIR resources.
const medplum = new MockClient();
await medplum.signIn({ /* practitioner profile */ });
```

## pre.practitioner.with-patient

```ts
// TODO: stub — practitioner signed in + 1 Patient seeded.
const medplum = new MockClient();
await medplum.signIn({ /* practitioner profile */ });
await medplum.createResource({ resourceType: 'Patient', name: [{ given: ['Test'], family: 'Patient' }] });
```

## pre.admin.empty

```ts
// TODO: stub — admin signed in, no project resources.
const medplum = new MockClient();
await medplum.signIn({ /* admin profile */ });
```

## pre.admin.with-project

```ts
// TODO: stub — admin signed in + 1 Project seeded.
const medplum = new MockClient();
await medplum.signIn({ /* admin profile */ });
await medplum.createResource({ resourceType: 'Project', name: 'Test Project' });
```
