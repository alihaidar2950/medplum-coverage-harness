import type { Surface } from '../schema/manifest.js';

/**
 * Catalog top-level page-like components reachable from the route walk.
 * Used to attach component file paths to each Surface so the prompt builder
 * can produce a correct test file path.
 */
export function discoverComponents(_targetRepo: string, _surfaces: Surface[]): Surface[] {
  throw new Error('TODO: implement component discovery');
}
