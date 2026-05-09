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
