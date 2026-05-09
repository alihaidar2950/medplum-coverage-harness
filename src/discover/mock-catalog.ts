import type { Precondition } from '../schema/manifest.js';

/**
 * Bootstrap the precondition catalog from (a) hand-curated seeds in
 * prompts/mock-setups.md and (b) extraction of distinct MockClient setup
 * patterns from existing tests in the target repo.
 */
export function discoverMockCatalog(_targetRepo: string): Precondition[] {
  throw new Error('TODO: implement mock catalog discovery');
}
