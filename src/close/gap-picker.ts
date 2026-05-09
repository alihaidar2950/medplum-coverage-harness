import type { Manifest, Unit } from '../schema/manifest.js';

export type Strategy =
  | 'highest-priority'
  | 'regression-first'
  | 'fewest-deps'
  | 'random';

/**
 * Pick the next gap to close, given a manifest and a strategy. The TODO
 * here is the actual heuristic; the function shape is fixed.
 */
export function pickGap(_manifest: Manifest, _strategy: Strategy): Unit | undefined {
  throw new Error('TODO: implement gap picker strategies');
}
