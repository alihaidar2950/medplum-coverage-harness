import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTestFiles, parseTestFile } from '../src/score/test-parser.js';
import { classifyMockSetup } from '../src/score/mock-call-extractor.js';
import { classifyBehavior, matchTestToUnits } from '../src/score/unit-matcher.js';
import { scoreUnits } from '../src/score/index.js';
import type { Manifest } from '../src/schema/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_TARGET = path.join(__dirname, 'fixtures/test-target');
const FIXTURE_SRC = path.join(FIXTURE_TARGET, 'packages/app/src');

function manifestWith(units: Manifest['units']): Manifest {
  return {
    version: 1,
    generated_at: '2026-05-09T14:00:00.000Z',
    target: { repo: FIXTURE_TARGET, scope: ['packages/app/src'] },
    surfaces: [
      {
        id: 'surface.signin',
        route: '/signin',
        component: 'SignInPage',
        discovered_via: 'AppRoutes.tsx:1',
      },
      {
        id: 'surface.home',
        route: '/',
        component: 'HomePage',
        discovered_via: 'AppRoutes.tsx:2',
      },
      {
        id: 'surface.ambiguous',
        route: '/ambiguous',
        component: 'AmbiguousPage',
        discovered_via: 'AppRoutes.tsx:3',
      },
    ],
    preconditions: [
      { id: 'pre.unauthed', description: '', auth: 'none', resources: [], mock_setup_ref: '' },
      { id: 'pre.practitioner.empty', description: '', auth: 'practitioner', resources: [], mock_setup_ref: '' },
      { id: 'pre.practitioner.with-patient', description: '', auth: 'practitioner', resources: [{ resourceType: 'Patient', count: 1 }], mock_setup_ref: '' },
    ],
    behaviors: [
      { id: 'beh.renders', description: '', assertion_ref: '' },
      { id: 'beh.form-submit-success', description: '', assertion_ref: '' },
      { id: 'beh.form-validation-error', description: '', assertion_ref: '' },
      { id: 'beh.empty-state', description: '', assertion_ref: '' },
    ],
    units,
  };
}

describe('discoverTestFiles', () => {
  it('finds *.test.tsx files under packages/app/src', () => {
    const files = discoverTestFiles(FIXTURE_TARGET).map((f) => path.basename(f)).sort();
    expect(files).toEqual([
      'AmbiguousPage.test.tsx',
      'HomePage.test.tsx',
      'SignInPage.test.tsx',
    ]);
  });
});

describe('parseTestFile', () => {
  it('extracts profile: null as the unauthed signal', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'SignInPage.test.tsx'));
    expect(parsed.baseName).toBe('SignInPage');
    expect(parsed.mockClientProfiles.some((p) => p.kind === 'null')).toBe(true);
    expect(parsed.testCases.map((t) => t.name)).toEqual(['Renders', 'Success', 'Validation error']);
  });

  it('extracts identifier profiles (DrAliceSmith) and createResource calls', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'HomePage.test.tsx'));
    expect(parsed.mockClientProfiles.some((p) => p.kind === 'identifier' && p.identifier === 'DrAliceSmith')).toBe(true);
    expect(parsed.createdResourceTypes).toContain('Patient');
  });

  it('treats bare new MockClient() as low-confidence', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'AmbiguousPage.test.tsx'));
    expect(parsed.mockClientProfiles[0].kind).toBe('unknown');
  });
});

describe('classifyMockSetup', () => {
  it('profile: null → pre.unauthed (confident)', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'SignInPage.test.tsx'));
    expect(classifyMockSetup(parsed)).toEqual({ precondition: 'pre.unauthed', confident: true });
  });

  it('practitioner identifier + Patient resource → pre.practitioner.with-patient', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'HomePage.test.tsx'));
    expect(classifyMockSetup(parsed)).toEqual({
      precondition: 'pre.practitioner.with-patient',
      confident: true,
    });
  });

  it('bare new MockClient() → pre.practitioner.empty with low confidence', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'AmbiguousPage.test.tsx'));
    expect(classifyMockSetup(parsed)).toEqual({
      precondition: 'pre.practitioner.empty',
      confident: false,
    });
  });
});

describe('classifyBehavior', () => {
  it('"Validation error" → form-validation-error', () => {
    expect(classifyBehavior({ name: 'Validation error', bodyText: '' })).toBe('beh.form-validation-error');
  });
  it('"Success" with submit body → form-submit-success', () => {
    expect(classifyBehavior({ name: 'Success', bodyText: 'fireEvent.click(submit)' })).toBe('beh.form-submit-success');
  });
  it('"Renders" → renders', () => {
    expect(classifyBehavior({ name: 'Renders', bodyText: '' })).toBe('beh.renders');
  });
  it('"Empty state shown when no patients" → empty-state', () => {
    expect(classifyBehavior({ name: 'Empty state shown when no patients', bodyText: '' })).toBe('beh.empty-state');
  });

  // Healthcare-specific patterns must beat the generic UI verbs they
  // co-occur with (a real audit-event test usually mentions "submit" or
  // "create"). These tests pin that ordering.
  it('AuditEvent in body → audit-event-emitted (beats the "submit" keyword)', () => {
    expect(
      classifyBehavior({
        name: 'creates user and submits the form',
        bodyText: "expect(spy).toHaveBeenCalledWith({ resourceType: 'AuditEvent' })",
      }),
    ).toBe('beh.audit-event-emitted');
  });
  it('"audit event" in name → audit-event-emitted', () => {
    expect(classifyBehavior({ name: 'emits an audit event', bodyText: '' })).toBe(
      'beh.audit-event-emitted',
    );
  });
  it('Consent literal in body → consent-honored', () => {
    expect(
      classifyBehavior({
        name: 'restricts access',
        bodyText: "createResource({ resourceType: 'Consent', ... })",
      }),
    ).toBe('beh.consent-honored');
  });
  it('"redacted" / "masked" in name → phi-masked', () => {
    expect(classifyBehavior({ name: 'PHI fields are masked for unauthorized', bodyText: '' })).toBe(
      'beh.phi-masked',
    );
    expect(classifyBehavior({ name: 'birthDate is redacted', bodyText: '' })).toBe(
      'beh.phi-masked',
    );
  });
});

describe('parseTestFile baseName for harness-generated tests', () => {
  // The harness writes tests as `<Component>.beh.<id>.test.tsx`. Without
  // stripping the `.beh.<id>` infix in baseName extraction, the matcher
  // would never find the surface, and the close→re-scan loop would never
  // see a freshly written test as COVERED.
  it('strips the .beh.<id> infix from generated test filenames', () => {
    const tmp = path.join(__dirname, 'fixtures/test-target/packages/app/src');
    const generated = path.join(tmp, 'SignInPage.beh.form-submit-success.test.tsx');
    fs.writeFileSync(generated, "test('x', () => {});\n", 'utf8');
    try {
      const parsed = parseTestFile(generated);
      expect(parsed.baseName).toBe('SignInPage');
    } finally {
      fs.rmSync(generated, { force: true });
    }
  });

  it('leaves non-harness names alone (no .beh. infix)', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'HomePage.test.tsx'));
    expect(parsed.baseName).toBe('HomePage');
  });
});

describe('matchTestToUnits', () => {
  const manifest = manifestWith([
    { id: 'unit.signin.unauthed.renders', surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.renders', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.signin.unauthed.form-submit-success', surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.form-submit-success', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.signin.unauthed.form-validation-error', surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.form-validation-error', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.home.with-patient.empty-state', surface: 'surface.home', precondition: 'pre.practitioner.with-patient', behavior: 'beh.empty-state', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.home.with-patient.renders', surface: 'surface.home', precondition: 'pre.practitioner.with-patient', behavior: 'beh.renders', priority: 'P0', status: 'GAP', covered_by: [] },
  ]);

  it('SignInPage.test.tsx → COVERED for renders + submit-success + validation-error', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'SignInPage.test.tsx'));
    const matches = matchTestToUnits(parsed, manifest);
    const ids = matches.map((m) => m.unitId).sort();
    expect(ids).toEqual([
      'unit.signin.unauthed.form-submit-success',
      'unit.signin.unauthed.form-validation-error',
      'unit.signin.unauthed.renders',
    ]);
    for (const m of matches) expect(m.status).toBe('COVERED');
  });

  it('HomePage.test.tsx hits with-patient precondition', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'HomePage.test.tsx'));
    const matches = matchTestToUnits(parsed, manifest);
    const ids = matches.map((m) => m.unitId).sort();
    expect(ids).toContain('unit.home.with-patient.renders');
    expect(ids).toContain('unit.home.with-patient.empty-state');
  });

  it('AmbiguousPage.test.tsx returns no matches when no surface named AmbiguousPage', () => {
    // Strip ambiguous surface to simulate "no surface for this test".
    const m: Manifest = {
      ...manifest,
      surfaces: manifest.surfaces.filter((s) => s.component !== 'AmbiguousPage'),
    };
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'AmbiguousPage.test.tsx'));
    expect(matchTestToUnits(parsed, m)).toEqual([]);
  });
});

describe('scoreUnits — integration on fixtures', () => {
  const manifest = manifestWith([
    { id: 'unit.signin.unauthed.renders', surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.renders', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.signin.unauthed.form-submit-success', surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.form-submit-success', priority: 'P0', status: 'GAP', covered_by: [] },
    { id: 'unit.ambiguous.empty.renders', surface: 'surface.ambiguous', precondition: 'pre.practitioner.empty', behavior: 'beh.renders', priority: 'P1', status: 'GAP', covered_by: [] },
  ]);

  it('upgrades matched units and records covered_by paths', () => {
    const scored = scoreUnits(manifest, FIXTURE_TARGET);
    const byId = new Map(scored.units.map((u) => [u.id, u]));
    expect(byId.get('unit.signin.unauthed.renders')?.status).toBe('COVERED');
    expect(byId.get('unit.signin.unauthed.renders')?.covered_by).toEqual([
      'packages/app/src/SignInPage.test.tsx',
    ]);
    // Bare-new-MockClient → PARTIAL
    expect(byId.get('unit.ambiguous.empty.renders')?.status).toBe('PARTIAL');
  });
});
