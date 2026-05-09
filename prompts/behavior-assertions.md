# Assertion guidance per behavior id

Each entry feeds `{{behavior.assertion_guidance}}` in the close-gap prompt.
These are stubs — refine once the matcher is real.

## beh.renders

```
Assert the component mounts without throwing and a key heading/landmark
text is present (e.g. expect(screen.getByRole('heading')).toBeInTheDocument()).
```

## beh.list-displayed

```
Assert that the seeded resources appear in the rendered list — at least one
row per seeded item, asserted via getAllByRole('row') or getByText.
```

## beh.form-submit-success

```
Fill the form via userEvent, submit, and assert the success path — either a
success toast/text or a navigation away from the form route.
```

## beh.form-validation-error

```
Submit the form with missing/invalid input and assert that the validation
message appears (getByText or getByRole('alert')).
```

## beh.navigates

```
Click a link/button and assert the new route renders — typically by
asserting on text unique to the destination view.
```

## beh.empty-state

```
With zero seeded resources, assert the empty-state message is rendered
(e.g. "No patients yet").
```

## beh.error-state

```
Force the MockClient to reject the relevant call and assert the error
state UI is rendered (alert role or visible error text).
```

## beh.phi-masked

```
Render a surface that displays a Patient or related FHIR resource and assert
that PHI fields the current role is NOT cleared to view are masked or absent
in the DOM. For an unauthorized viewer, expect names/MRNs/birthDates to be
either redacted (e.g. "—") or not rendered at all. For an authorized viewer,
assert the same fields ARE present so the test catches over-masking too.
```

## beh.audit-event-emitted

```
After performing an audit-relevant action (resource read/write/delete,
sign-in, permission change), assert that the MockClient observed an
AuditEvent create call. Use a spy/mock on medplum.createResource and check
its calls for resourceType: 'AuditEvent' with the expected outcome and
agent.who reference. The presence of the audit event is the assertion —
its absence is the failure.
```

## beh.consent-honored

```
Seed a Consent resource on MockClient that restricts access (e.g. Patient
has provision.actor excluding the current Practitioner, or category
restricts release). Render the surface and assert that protected fields are
withheld OR an explicit "consent restricts access" notice appears. The
flip-side test (Consent grants access → fields render) should be a sibling
unit so the assertion catches both over- and under-honoring.
```
