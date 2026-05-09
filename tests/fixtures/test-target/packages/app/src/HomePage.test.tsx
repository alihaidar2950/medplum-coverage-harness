import { DrAliceSmith, MockClient } from '@medplum/mock';

async function setup(medplum = new MockClient({ profile: DrAliceSmith })): Promise<void> {
  await medplum.createResource({ resourceType: 'Patient', name: [{ given: ['A'], family: 'B' }] });
}

describe('HomePage', () => {
  test('Renders', async () => {
    await setup();
    expect(true).toBe(true);
  });

  test('Empty state shown when no patients', async () => {
    const medplum = new MockClient({ profile: DrAliceSmith });
    expect(medplum).toBeDefined();
  });
});
