import * as path from 'node:path';
import type { Manifest, Unit, UnitStatus } from '../schema/manifest.js';
import { discover } from '../discover/index.js';
import { loadConfig, resolveTargetPath } from '../util/paths.js';
import { discoverTestFiles, parseTestFile } from './test-parser.js';
import { matchTestToUnits, type UnitMatch } from './unit-matcher.js';

export interface ScanOptions {
  targetRepo?: string;
  generatedAt?: string;
}

/**
 * Top-level scan: discover catalogs, build the manifest, then score
 * existing tests against units. Returns the scored manifest.
 */
export async function scan(opts: ScanOptions = {}): Promise<Manifest> {
  const targetRepo = opts.targetRepo ?? resolveTargetPath(loadConfig());
  const manifest = discover({ targetRepo, generatedAt: opts.generatedAt });
  return scoreUnits(manifest, targetRepo);
}

const STATUS_RANK: Record<UnitStatus, number> = {
  GAP: 0,
  REGRESSION: 0,
  IGNORED: 0,
  PARTIAL: 1,
  COVERED: 2,
};

/**
 * Apply test-derived matches to the manifest's units. The `targetRepo` is
 * needed so we can read tests from disk; pass it through from scan().
 */
export function scoreUnits(manifest: Manifest, targetRepo: string): Manifest {
  const testFiles = discoverTestFiles(targetRepo);

  const matchesByUnitId = new Map<string, { status: 'COVERED' | 'PARTIAL'; sources: Set<string> }>();
  for (const file of testFiles) {
    const parsed = parseTestFile(file);
    const matches = matchTestToUnits(parsed, manifest);
    for (const m of matches) registerMatch(matchesByUnitId, m, targetRepo);
  }

  const units: Unit[] = manifest.units.map((u) => {
    const m = matchesByUnitId.get(u.id);
    if (!m) return u;
    if (STATUS_RANK[m.status] <= STATUS_RANK[u.status]) return u;
    return { ...u, status: m.status, covered_by: [...m.sources].sort() };
  });

  return { ...manifest, units };
}

function registerMatch(
  bag: Map<string, { status: 'COVERED' | 'PARTIAL'; sources: Set<string> }>,
  m: UnitMatch,
  targetRepo: string,
): void {
  const rel = path.relative(targetRepo, m.source).split(path.sep).join('/');
  const existing = bag.get(m.unitId);
  if (!existing) {
    bag.set(m.unitId, { status: m.status, sources: new Set([rel]) });
    return;
  }
  // Upgrade PARTIAL → COVERED if a stronger match arrives.
  if (existing.status === 'PARTIAL' && m.status === 'COVERED') {
    existing.status = 'COVERED';
  }
  existing.sources.add(rel);
}
