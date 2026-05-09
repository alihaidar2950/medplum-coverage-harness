import type { Manifest } from '../schema/manifest.js';
import { discover } from '../discover/index.js';
import { loadConfig, resolveTargetPath } from '../util/paths.js';

export interface ScanOptions {
  /** Override the target repo path; otherwise read from harness.config.json. */
  targetRepo?: string;
  generatedAt?: string;
}

/**
 * Top-level scan: discover catalogs, build the manifest, then score
 * existing tests against units. Scoring is currently TODO — for now this
 * returns the discover-only manifest (every unit GAP).
 */
export async function scan(opts: ScanOptions = {}): Promise<Manifest> {
  const targetRepo =
    opts.targetRepo ??
    resolveTargetPath(loadConfig());

  const manifest = discover({ targetRepo, generatedAt: opts.generatedAt });
  return scoreUnits(manifest);
}

/**
 * Upgrade unit statuses from GAP → COVERED/PARTIAL based on parsed tests.
 * TODO: implement the test parser → unit matcher pipeline. For now this is
 * the identity so scan returns a discover-only manifest.
 */
export function scoreUnits(manifest: Manifest): Manifest {
  return manifest;
}
