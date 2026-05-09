import type { Surface } from '../schema/manifest.js';

/**
 * Walk packages/app/src/AppRoutes.tsx with ts-morph; emit one Surface per
 * route. Each surface carries its route, top-level component name, and a
 * `discovered_via` provenance string so the manifest stays auditable.
 */
export function discoverRoutes(_targetRepo: string): Surface[] {
  throw new Error('TODO: implement route discovery via ts-morph');
}
