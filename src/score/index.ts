import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Manifest, Unit, UnitStatus } from '../schema/manifest.js';
import { discover } from '../discover/index.js';
import { loadConfig, manifestPath, resolveTargetPath } from '../util/paths.js';
import { readManifest } from '../util/yaml.js';
import { detectRegressions, type UnitDiff } from './regression-detector.js';
import { discoverTestFiles, parseTestFile } from './test-parser.js';
import { matchTestToUnits, type UnitMatch } from './unit-matcher.js';

export interface ScanOptions {
  targetRepo?: string;
  generatedAt?: string;
}

/**
 * Top-level scan: discover catalogs, build the manifest, then score
 * existing tests against units. Returns the scored manifest. Does NOT
 * tag REGRESSION; use `scanWithRegressions` for that.
 */
export async function scan(opts: ScanOptions = {}): Promise<Manifest> {
  const targetRepo = opts.targetRepo ?? resolveTargetPath(loadConfig());
  const manifest = discover({ targetRepo, generatedAt: opts.generatedAt });
  return scoreUnits(manifest, targetRepo);
}

/**
 * Full scan pipeline: read the on-disk manifest as `previous`, run a fresh
 * scan, and tag REGRESSION on units that were COVERED before and aren't now.
 *
 * This is the front door for the close and loop control paths — without it,
 * the `regression-first` strategy and the `regressions==0` stop condition
 * have nothing to act on. The bare `scan()` is kept for callers (tests,
 * isolated targets) that don't have a baseline manifest on disk.
 *
 * Pass `opts.previous` to inject a baseline directly; otherwise the helper
 * reads `manifestPath()` from disk (harness cwd).
 */
export async function scanWithRegressions(
  opts: ScanOptions & { previous?: Manifest } = {},
): Promise<{ manifest: Manifest; diff: UnitDiff; previous?: Manifest }> {
  let previous: Manifest | undefined = opts.previous;
  if (previous === undefined && fs.existsSync(manifestPath())) {
    try {
      previous = readManifest(manifestPath());
    } catch {
      // Bad on-disk manifest: treat as no baseline rather than erroring out.
      // Mirrors the `commands/scan.ts` behaviour so corrupt manifests don't
      // wedge the close/loop paths.
      previous = undefined;
    }
  }
  const fresh = await scan(opts);
  const { manifest, diff } = detectRegressions(previous, fresh);
  return { manifest, diff, previous };
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
