import type { Manifest } from '../schema/manifest.js';
import type { CloseOutcome } from '../close/index.js';

/**
 * Render the close report (Before / Generated Test / After / Verify). TODO.
 */
export function renderCloseReport(
  _before: Manifest,
  _after: Manifest,
  _outcome: CloseOutcome,
  _generatedTest: string,
): string {
  throw new Error('TODO: implement close report renderer');
}
