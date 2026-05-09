import type { Precondition } from '../schema/manifest.js';

/**
 * Hand-curated precondition seeds. Mirrors the 5 entries in
 * prompts/mock-setups.md. Real implementation will additionally extract
 * patterns from existing tests in the target repo and merge.
 */
export function discoverMockCatalog(_targetRepo: string): Precondition[] {
  return [
    {
      id: 'pre.unauthed',
      description: 'unauthenticated MockClient — no signed-in user',
      auth: 'none',
      resources: [],
      mock_setup_ref: 'prompts/mock-setups.md#pre.unauthed',
    },
    {
      id: 'pre.practitioner.empty',
      description: 'practitioner signed in, no FHIR resources seeded',
      auth: 'practitioner',
      resources: [],
      mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.empty',
    },
    {
      id: 'pre.practitioner.with-patient',
      description: 'practitioner signed in, 1 Patient seeded',
      auth: 'practitioner',
      resources: [{ resourceType: 'Patient', count: 1 }],
      mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.with-patient',
    },
    {
      id: 'pre.admin.empty',
      description: 'project admin signed in, no project resources',
      auth: 'admin',
      resources: [],
      mock_setup_ref: 'prompts/mock-setups.md#pre.admin.empty',
    },
    {
      id: 'pre.admin.with-project',
      description: 'project admin signed in, 1 Project seeded',
      auth: 'admin',
      resources: [{ resourceType: 'Project', count: 1 }],
      mock_setup_ref: 'prompts/mock-setups.md#pre.admin.with-project',
    },
  ];
}
