import type { Manifest } from '../schema/manifest.js';

/**
 * Render a scan report. Header should surface gap counts by priority,
 * regressions, new units, retired units (per design §3.4). TODO.
 */
export function renderScanReport(_manifest: Manifest, _previous?: Manifest): string {
  throw new Error('TODO: implement scan report renderer');
}
