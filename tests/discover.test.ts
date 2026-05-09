import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRoutesFromFile } from '../src/discover/routes.js';
import { discover } from '../src/discover/index.js';
import { parseManifest } from '../src/schema/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'AppRoutes.tsx');

describe('discoverRoutesFromFile (fixture)', () => {
  const routes = discoverRoutesFromFile(FIXTURE_FILE);
  const byRoute = new Map(routes.map((r) => [r.route, r]));

  it('extracts top-level path routes', () => {
    expect(byRoute.get('/signin')?.component).toBe('SignInPage');
    expect(byRoute.get('/')?.component).toBe('HomePage');
  });

  it('joins nested routes with their parent path', () => {
    expect(byRoute.get('/admin')?.component).toBe('ProjectPage');
    expect(byRoute.get('/admin/bots')?.component).toBe('BotsPage');
    expect(byRoute.get('/admin/users')?.component).toBe('UsersPage');
  });

  it('skips Navigate redirects', () => {
    expect(byRoute.has('/admin/patients')).toBe(false);
  });

  it('skips index-only routes (no path attribute)', () => {
    // The index route under /:resourceType/:id has no path of its own.
    const resourceRoutes = routes.filter((r) =>
      r.route.startsWith('/:resourceType/:id'),
    );
    // Should have the parent + edit, but no extra entry from the <Route index> child.
    expect(resourceRoutes.map((r) => r.route).sort()).toEqual([
      '/:resourceType/:id',
      '/:resourceType/:id/edit',
    ]);
  });

  it('skips the top-level wrapper Route that only carries errorElement', () => {
    expect(routes.every((r) => r.component !== 'ErrorPage')).toBe(true);
  });

  it('captures the import module specifier for each component', () => {
    expect(byRoute.get('/signin')?.componentImportPath).toBe('./SignInPage');
    expect(byRoute.get('/admin/bots')?.componentImportPath).toBe('./admin/BotsPage');
  });

  it('records the source line of each Route', () => {
    expect(byRoute.get('/signin')?.line).toBeGreaterThan(0);
  });
});

describe('discover() — manifest assembly', () => {
  // Use the fixture as the "target" — files won't resolve under packages/app/src
  // so componentFile paths fall back to the unresolved guess. That's fine for
  // a fixture-driven test; we're checking shape, not file existence.
  const manifest = discover({
    targetRepo: FIXTURE_DIR,
    generatedAt: '2026-05-09T14:00:00.000Z',
    routes: discoverRoutesFromFile(FIXTURE_FILE),
  });

  it('produces a manifest that passes schema + cross-ref validation', () => {
    expect(() => parseManifest(manifest)).not.toThrow();
  });

  it('includes the seven hardcoded behaviors', () => {
    expect(manifest.behaviors.map((b) => b.id).sort()).toEqual([
      'beh.empty-state',
      'beh.error-state',
      'beh.form-submit-success',
      'beh.form-validation-error',
      'beh.list-displayed',
      'beh.navigates',
      'beh.renders',
    ]);
  });

  it('includes all five hand-curated preconditions', () => {
    expect(manifest.preconditions.map((p) => p.id).sort()).toEqual([
      'pre.admin.empty',
      'pre.admin.with-project',
      'pre.practitioner.empty',
      'pre.practitioner.with-patient',
      'pre.unauthed',
    ]);
  });

  it('assigns P0 to /signin and /', () => {
    const signin = manifest.surfaces.find((s) => s.route === '/signin');
    const home = manifest.surfaces.find((s) => s.route === '/');
    expect(signin).toBeDefined();
    expect(home).toBeDefined();
    const signinUnit = manifest.units.find((u) => u.surface === signin!.id);
    const homeUnit = manifest.units.find((u) => u.surface === home!.id);
    expect(signinUnit?.priority).toBe('P0');
    expect(homeUnit?.priority).toBe('P0');
  });

  it('assigns P2 to /admin/* routes', () => {
    const adminBots = manifest.surfaces.find((s) => s.route === '/admin/bots');
    expect(adminBots).toBeDefined();
    const u = manifest.units.find((x) => x.surface === adminBots!.id);
    expect(u?.priority).toBe('P2');
  });

  it('assigns P1 to clinical (resource) routes', () => {
    const resource = manifest.surfaces.find((s) => s.route === '/:resourceType/:id');
    expect(resource).toBeDefined();
    const u = manifest.units.find((x) => x.surface === resource!.id);
    expect(u?.priority).toBe('P1');
  });

  it('filters preconditions: auth surfaces only get pre.unauthed', () => {
    const signin = manifest.surfaces.find((s) => s.route === '/signin')!;
    const pres = new Set(
      manifest.units.filter((u) => u.surface === signin.id).map((u) => u.precondition),
    );
    expect([...pres]).toEqual(['pre.unauthed']);
  });

  it('filters preconditions: /admin/* only get admin auth preconditions', () => {
    const adminBots = manifest.surfaces.find((s) => s.route === '/admin/bots')!;
    const pres = new Set(
      manifest.units
        .filter((u) => u.surface === adminBots.id)
        .map((u) => u.precondition),
    );
    expect([...pres].sort()).toEqual(['pre.admin.empty', 'pre.admin.with-project']);
  });

  it('filters preconditions: clinical surfaces only get practitioner auth preconditions', () => {
    const home = manifest.surfaces.find((s) => s.route === '/')!;
    const pres = new Set(
      manifest.units.filter((u) => u.surface === home.id).map((u) => u.precondition),
    );
    expect([...pres].sort()).toEqual(['pre.practitioner.empty', 'pre.practitioner.with-patient']);
  });

  it('all units start with status=GAP and empty covered_by', () => {
    expect(manifest.units.every((u) => u.status === 'GAP')).toBe(true);
    expect(manifest.units.every((u) => u.covered_by.length === 0)).toBe(true);
  });

  it('emits 7 behaviors per (surface × applicable precondition)', () => {
    const home = manifest.surfaces.find((s) => s.route === '/')!;
    const homeUnits = manifest.units.filter((u) => u.surface === home.id);
    // 2 practitioner preconditions × 7 behaviors = 14
    expect(homeUnits.length).toBe(14);
  });
});
