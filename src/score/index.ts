import type { Manifest } from '../schema/manifest.js';

/**
 * Top-level scoring entry: parses existing tests, matches them to units,
 * and applies regression detection by diffing against the previous manifest
 * (if one exists). Returns the new manifest.
 */
export async function scan(): Promise<Manifest> {
  throw new Error('TODO: implement score/scan step');
}

export function scoreUnits(_manifest: Manifest): Manifest {
  throw new Error('TODO: implement unit scoring');
}
