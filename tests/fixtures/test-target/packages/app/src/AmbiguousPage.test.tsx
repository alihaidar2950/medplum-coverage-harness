import { MockClient } from '@medplum/mock';

describe('AmbiguousPage', () => {
  // Bare new MockClient() — low-confidence default, should map to PARTIAL.
  const medplum = new MockClient();

  test('Renders', () => {
    expect(medplum).toBeDefined();
  });
});
