import type {
  Behavior,
  BehaviorId,
  Manifest,
  Precondition,
  Priority,
  Surface,
  Unit,
} from '../schema/manifest.js';
import { discoverRoutes, type DiscoveredRoute } from './routes.js';
import { resolveComponents, type ResolvedComponent } from './components.js';
import { discoverMockCatalog } from './mock-catalog.js';

export interface DiscoverOptions {
  targetRepo: string;
  /** Override generated_at; injectable for deterministic tests. */
  generatedAt?: string;
  /** Override the route list; injectable for tests that don't need ts-morph. */
  routes?: DiscoveredRoute[];
}

const BEHAVIORS: Behavior[] = [
  { id: 'beh.renders', description: 'component mounts without throwing', assertion_ref: 'prompts/behavior-assertions.md#beh.renders' },
  { id: 'beh.list-displayed', description: 'seeded resources appear in the rendered list', assertion_ref: 'prompts/behavior-assertions.md#beh.list-displayed' },
  { id: 'beh.form-submit-success', description: 'form submission produces success state or navigation', assertion_ref: 'prompts/behavior-assertions.md#beh.form-submit-success' },
  { id: 'beh.form-validation-error', description: 'invalid form submit shows validation message', assertion_ref: 'prompts/behavior-assertions.md#beh.form-validation-error' },
  { id: 'beh.navigates', description: 'click navigates to a new route', assertion_ref: 'prompts/behavior-assertions.md#beh.navigates' },
  { id: 'beh.empty-state', description: 'with zero resources, empty-state UI is rendered', assertion_ref: 'prompts/behavior-assertions.md#beh.empty-state' },
  { id: 'beh.error-state', description: 'failed FHIR call yields error UI', assertion_ref: 'prompts/behavior-assertions.md#beh.error-state' },
];

/**
 * Build a Manifest from the target repo. Surfaces come from AppRoutes.tsx,
 * preconditions from the hand-curated mock catalog, behaviors from the fixed
 * 7-verb enum. Units are emitted as the filtered Cartesian product
 * (auth-based filter) with status=GAP. Score is responsible for upgrading
 * unit statuses on a subsequent pass.
 */
export function discover(opts: DiscoverOptions): Manifest {
  const rawRoutes = opts.routes ?? discoverRoutes(opts.targetRepo);
  const resolved = resolveComponents(opts.targetRepo, rawRoutes);

  const surfaces = buildSurfaces(resolved);
  const preconditions = discoverMockCatalog(opts.targetRepo);
  const units = buildUnits(surfaces, preconditions);

  return {
    version: 1,
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    target: { repo: opts.targetRepo, scope: ['packages/app/src'] },
    surfaces,
    preconditions,
    behaviors: BEHAVIORS,
    units,
  };
}

function buildSurfaces(resolved: ResolvedComponent[]): Surface[] {
  const seen = new Map<string, number>();
  return resolved.map((r) => {
    const baseId = `surface.${routeSlug(r.route)}`;
    const n = seen.get(baseId) ?? 0;
    seen.set(baseId, n + 1);
    const id = n === 0 ? baseId : `${baseId}--${n + 1}`;
    return {
      id,
      route: r.route,
      component: r.component,
      discovered_via: `${r.componentFile}:${r.line}`,
    };
  });
}

function routeSlug(route: string): string {
  if (route === '/' || route === '') return 'root';
  const slug = route
    .replace(/^\//, '')
    .replace(/\//g, '.')
    .replace(/:/g, '~')
    .replace(/[^a-zA-Z0-9._~-]/g, '-');
  return slug || 'root';
}

const AUTH_PREFIXES = [
  '/signin',
  '/register',
  '/oauth',
  '/setpassword',
  '/resetpassword',
  '/verifyemail',
  '/changepassword',
  '/mfa',
];

function isAuthRoute(route: string): boolean {
  return AUTH_PREFIXES.some((p) => route === p || route.startsWith(p + '/'));
}

function priorityFor(route: string): Priority {
  if (route === '/') return 'P0';
  if (isAuthRoute(route)) return 'P0';
  if (
    route.startsWith('/admin') ||
    route === '/batch' ||
    route === '/security' ||
    route === '/smart' ||
    route.startsWith('/forms') ||
    route.startsWith('/bulk')
  ) {
    return 'P2';
  }
  return 'P1';
}

function preconditionsForSurface(s: Surface, all: Precondition[]): Precondition[] {
  if (isAuthRoute(s.route)) return all.filter((p) => p.id === 'pre.unauthed');
  if (s.route.startsWith('/admin')) return all.filter((p) => p.auth === 'admin');
  return all.filter((p) => p.auth === 'practitioner');
}

function buildUnits(surfaces: Surface[], preconditions: Precondition[]): Unit[] {
  const units: Unit[] = [];
  for (const surface of surfaces) {
    const priority = priorityFor(surface.route);
    const pres = preconditionsForSurface(surface, preconditions);
    for (const pre of pres) {
      for (const beh of BEHAVIORS) {
        units.push({
          id: unitId(surface, pre, beh.id),
          surface: surface.id,
          precondition: pre.id,
          behavior: beh.id,
          priority,
          status: 'GAP',
          covered_by: [],
        });
      }
    }
  }
  return units;
}

function unitId(surface: Surface, pre: Precondition, beh: BehaviorId): string {
  // Surface id already starts with "surface."; strip the prefix for compactness.
  const sBase = surface.id.replace(/^surface\./, '');
  const pBase = pre.id.replace(/^pre\./, '');
  const bBase = beh.replace(/^beh\./, '');
  return `unit.${sBase}.${pBase}.${bBase}`;
}
