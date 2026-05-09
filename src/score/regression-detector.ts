import * as fs from 'node:fs';
import { manifestPath, previousManifestPath } from '../util/paths.js';
import { readManifest, writeManifest } from '../util/yaml.js';
import type { Manifest, Unit } from '../schema/manifest.js';

/** File-level: copy current manifest into the previous slot before a new scan. */
export function preservePreviousManifest(): void {
  if (!fs.existsSync(manifestPath())) return;
  const current = readManifest(manifestPath());
  writeManifest(previousManifestPath(), current);
}

export interface UnitDiff {
  /** Unit ids present now that were absent in the previous manifest. */
  newIds: string[];
  /** Unit ids present previously that no longer exist. */
  retiredIds: string[];
  /**
   * Units that were COVERED previously and are now a GAP — flagged as
   * REGRESSION on the returned manifest.
   */
  regressionIds: string[];
}

/**
 * Compute new/retired/regressions and return a manifest with REGRESSION status
 * applied where appropriate. If `previous` is undefined (first scan), every
 * unit counts as new and there are no regressions.
 */
export function detectRegressions(
  previous: Manifest | undefined,
  current: Manifest,
): { manifest: Manifest; diff: UnitDiff } {
  const previousById = new Map<string, Unit>();
  if (previous) {
    for (const u of previous.units) previousById.set(u.id, u);
  }
  const currentById = new Map<string, Unit>();
  for (const u of current.units) currentById.set(u.id, u);

  const newIds: string[] = [];
  const retiredIds: string[] = [];
  const regressionIds: string[] = [];

  for (const [id, u] of currentById) {
    const prev = previousById.get(id);
    if (!prev) {
      newIds.push(id);
      continue;
    }
    if (prev.status === 'COVERED' && u.status === 'GAP') regressionIds.push(id);
  }
  for (const id of previousById.keys()) {
    if (!currentById.has(id)) retiredIds.push(id);
  }

  const regressionSet = new Set(regressionIds);
  const units: Unit[] = current.units.map((u) =>
    regressionSet.has(u.id) ? { ...u, status: 'REGRESSION' as const } : u,
  );

  return {
    manifest: { ...current, units },
    diff: { newIds, retiredIds, regressionIds },
  };
}
