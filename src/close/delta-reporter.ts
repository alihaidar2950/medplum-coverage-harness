import type { Manifest } from '../schema/manifest.js';

export interface CloseDelta {
  covered: number;
  partial: number;
}

/**
 * Compute and write the close report (Before / Generated Test / After /
 * Verify if run). TODO: actual diff computation and Markdown rendering.
 */
export function computeDelta(_before: Manifest, _after: Manifest): CloseDelta {
  throw new Error('TODO: implement delta computation');
}
