import type { Manifest, UnitStatus } from '../schema/manifest.js';

export interface CloseDelta {
  /** Net change in COVERED unit count (after - before). */
  covered: number;
  /** Net change in PARTIAL unit count (after - before). */
  partial: number;
}

export function computeDelta(before: Manifest, after: Manifest): CloseDelta {
  return {
    covered: countByStatus(after, 'COVERED') - countByStatus(before, 'COVERED'),
    partial: countByStatus(after, 'PARTIAL') - countByStatus(before, 'PARTIAL'),
  };
}

function countByStatus(m: Manifest, s: UnitStatus): number {
  return m.units.filter((u) => u.status === s).length;
}
