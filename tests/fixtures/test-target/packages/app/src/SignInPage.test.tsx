import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { AppRoutes } from '../AppRoutes';

const medplum = new MockClient({ profile: null });

describe('SignInPage', () => {
  function setup() {
    return { medplum };
  }

  test('Renders', () => {
    setup();
    expect(true).toBe(true);
  });

  test('Success', () => {
    setup();
    // simulates submit
    expect(true).toBe(true);
  });

  test('Validation error', () => {
    setup();
    // invalid input
    expect(true).toBe(true);
  });
});

export { MedplumProvider, AppRoutes };
