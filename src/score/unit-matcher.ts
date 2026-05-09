import type { Manifest, Unit } from '../schema/manifest.js';
import type { ParsedTest } from './test-parser.js';

/**
 * Given a parsed test and the catalogs in the manifest, return the unit ids
 * the test plausibly covers. Ambiguous matches yield PARTIAL; confident
 * matches yield COVERED.
 */
export function matchTestToUnits(
  _parsed: ParsedTest,
  _manifest: Manifest,
): { unit: Unit; status: 'COVERED' | 'PARTIAL' }[] {
  throw new Error('TODO: implement unit matcher');
}
