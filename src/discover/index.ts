import type { Manifest } from '../schema/manifest.js';
import { discoverRoutes } from './routes.js';
import { discoverComponents } from './components.js';
import { discoverMockCatalog } from './mock-catalog.js';

/**
 * Walk the target repo and produce a partial manifest containing surfaces,
 * preconditions, and behaviors. Score is responsible for filling in unit
 * statuses; this step only establishes the catalogs.
 */
export function discover(_targetRepo: string): Manifest {
  void discoverRoutes;
  void discoverComponents;
  void discoverMockCatalog;
  throw new Error('TODO: implement discover step');
}
