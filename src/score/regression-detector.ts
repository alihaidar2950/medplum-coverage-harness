import * as fs from 'node:fs';
import { manifestPath, previousManifestPath } from '../util/paths.js';
import { readManifest, writeManifest } from '../util/yaml.js';
import type { Manifest } from '../schema/manifest.js';

/**
 * File plumbing only: copy current manifest to previous before a new scan.
 * The actual diff (was COVERED, now GAP → REGRESSION; etc.) is TODO.
 */
export function preservePreviousManifest(): void {
  if (!fs.existsSync(manifestPath())) return;
  const current = readManifest(manifestPath());
  writeManifest(previousManifestPath(), current);
}

export function detectRegressions(
  _previous: Manifest | undefined,
  _current: Manifest,
): Manifest {
  throw new Error('TODO: implement regression detection diff');
}
