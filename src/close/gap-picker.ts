import type { Manifest, Precondition, Priority, Unit } from '../schema/manifest.js';

export type Strategy =
  | 'highest-priority'
  | 'regression-first'
  | 'fewest-deps'
  | 'random';

export const STRATEGIES: Strategy[] = [
  'highest-priority',
  'regression-first',
  'fewest-deps',
  'random',
];

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };

export function pickGap(
  manifest: Manifest,
  strategy: Strategy,
  rng: () => number = Math.random,
): Unit | undefined {
  const candidates = manifest.units.filter(
    (u) => u.status === 'GAP' || u.status === 'REGRESSION',
  );
  if (candidates.length === 0) return undefined;

  switch (strategy) {
    case 'highest-priority':
      return [...candidates].sort(comparePriorityThenId)[0];

    case 'regression-first': {
      const regressions = candidates.filter((u) => u.status === 'REGRESSION');
      if (regressions.length > 0) return [...regressions].sort(comparePriorityThenId)[0];
      return [...candidates].sort(comparePriorityThenId)[0];
    }

    case 'fewest-deps': {
      const preById = new Map(manifest.preconditions.map((p) => [p.id, p]));
      return [...candidates].sort((a, b) => {
        const da = depsCount(preById.get(a.precondition));
        const db = depsCount(preById.get(b.precondition));
        if (da !== db) return da - db;
        return comparePriorityThenId(a, b);
      })[0];
    }

    case 'random': {
      const idx = Math.floor(rng() * candidates.length);
      return candidates[idx];
    }
  }
}

export function pickGapById(manifest: Manifest, id: string): Unit | undefined {
  return manifest.units.find((u) => u.id === id);
}

function comparePriorityThenId(a: Unit, b: Unit): number {
  const pa = PRIORITY_RANK[a.priority];
  const pb = PRIORITY_RANK[b.priority];
  if (pa !== pb) return pa - pb;
  return a.id.localeCompare(b.id);
}

function depsCount(p: Precondition | undefined): number {
  if (!p) return Number.MAX_SAFE_INTEGER;
  let n = 0;
  if (p.auth !== 'none') n += 1;
  for (const r of p.resources) n += r.count;
  return n;
}
