/**
 * Extract MockClient.* call patterns from a test file and produce a
 * normalized signature. Used by the unit matcher to align tests with
 * preconditions in the catalog.
 */
export function extractMockCallSignature(_source: string): string {
  throw new Error('TODO: implement MockClient call extraction');
}
