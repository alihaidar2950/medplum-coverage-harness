# Close Report

- **Generated:** 2026-05-11T01:28:34.525Z
- **Gap:** `unit.signin.unauthed.form-validation-error`
- **Priority:** P0
- **Agent outcome:** success
- **Gap closed:** yes
- **Delta:** covered +1, partial 0

## Targeted unit

- **Surface:** `surface.signin`
- **Precondition:** `pre.unauthed`
- **Behavior:** `beh.form-validation-error`
- **Status before:** GAP
- **Status after:** COVERED

## Coverage summary

**Before** — 556 units total

| Priority | COVERED | PARTIAL | GAP | REGRESSION | IGNORED | Total |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 2 | 0 | 40 | 0 | 0 | 42 |
| P1 | 1 | 27 | 226 | 0 | 0 | 254 |
| P2 | 9 | 6 | 245 | 0 | 0 | 260 |

**After** — 556 units total

| Priority | COVERED | PARTIAL | GAP | REGRESSION | IGNORED | Total |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 3 | 0 | 39 | 0 | 0 | 42 |
| P1 | 1 | 27 | 226 | 0 | 0 | 254 |
| P2 | 9 | 6 | 245 | 0 | 0 | 260 |

**Delta**

| Priority | COVERED Δ | PARTIAL Δ | GAP Δ |
| --- | --- | --- | --- |
| P0 | +1 | 0 | -1 |
| P1 | 0 | 0 | 0 |
| P2 | 0 | 0 | 0 |

## Expected test file

`packages/app/src/SignInPage.beh.form-validation-error.test.tsx`

## Generated test

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { SignInPage } from './SignInPage';

describe('SignInPage', () => {
  test('shows a validation error when submitting invalid credentials', async () => {
    const medplum = new MockClient({ profile: null });
    render(
      <MemoryRouter>
        <MedplumProvider medplum={medplum}>
          <SignInPage />
        </MedplumProvider>
      </MemoryRouter>
    );

    // Submit without filling in required fields
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
```
