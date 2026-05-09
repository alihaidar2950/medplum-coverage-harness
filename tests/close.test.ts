import { describe, it, expect } from 'vitest';
import {
  buildClosePrompt,
  composeTestFilePath,
  deriveSurfaceFileLocation,
  readSection,
} from '../src/close/prompt-builder.js';
import { pickGap, pickGapById } from '../src/close/gap-picker.js';
import { computeDelta } from '../src/close/delta-reporter.js';
import type { Manifest, Surface, Unit } from '../src/schema/manifest.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, '..');

function unit(over: Partial<Unit>): Unit {
  return {
    id: 'unit.x',
    surface: 'surface.x',
    precondition: 'pre.unauthed',
    behavior: 'beh.renders',
    priority: 'P1',
    status: 'GAP',
    covered_by: [],
    ...over,
  };
}

function surface(over: Partial<Surface> = {}): Surface {
  return {
    id: 'surface.signin',
    route: '/signin',
    component: 'SignInPage',
    discovered_via: 'packages/app/src/SignInPage.tsx:71',
    ...over,
  };
}

function manifestOf(units: Unit[], extras: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    generated_at: '2026-05-09T14:00:00.000Z',
    target: { repo: '../medplum', scope: ['packages/app/src'] },
    surfaces: [],
    preconditions: [
      { id: 'pre.unauthed', description: 'no auth', auth: 'none', resources: [], mock_setup_ref: '' },
      { id: 'pre.practitioner.empty', description: 'practitioner', auth: 'practitioner', resources: [], mock_setup_ref: '' },
      { id: 'pre.practitioner.with-patient', description: 'practitioner', auth: 'practitioner', resources: [{ resourceType: 'Patient', count: 1 }], mock_setup_ref: '' },
      { id: 'pre.admin.with-project', description: 'admin', auth: 'admin', resources: [{ resourceType: 'Project', count: 1 }], mock_setup_ref: '' },
    ],
    behaviors: [],
    units,
    ...extras,
  };
}

describe('deriveSurfaceFileLocation', () => {
  it('parses top-level component path', () => {
    expect(
      deriveSurfaceFileLocation(surface({ discovered_via: 'packages/app/src/SignInPage.tsx:71' })),
    ).toEqual({ path: '', name: 'SignInPage' });
  });

  it('parses nested directory', () => {
    expect(
      deriveSurfaceFileLocation(
        surface({ discovered_via: 'packages/app/src/admin/BotsPage.tsx:93' }),
      ),
    ).toEqual({ path: 'admin', name: 'BotsPage' });
  });

  it('falls back to the surface component when discovered_via is unparseable', () => {
    expect(
      deriveSurfaceFileLocation(surface({ discovered_via: 'unknown', component: 'Foo' })),
    ).toEqual({ path: '', name: 'Foo' });
  });
});

describe('composeTestFilePath', () => {
  it('omits the dir when path is empty', () => {
    expect(composeTestFilePath('', 'SignInPage', 'beh.renders')).toBe(
      'packages/app/src/SignInPage.beh.renders.test.tsx',
    );
  });
  it('preserves nested paths', () => {
    expect(composeTestFilePath('admin', 'BotsPage', 'beh.form-submit-success')).toBe(
      'packages/app/src/admin/BotsPage.beh.form-submit-success.test.tsx',
    );
  });
});

describe('readSection', () => {
  it('extracts code block under ## pre.unauthed in mock-setups.md', () => {
    const text = readSection(path.join(HARNESS_ROOT, 'prompts/mock-setups.md'), 'pre.unauthed');
    expect(text).toContain('new MockClient');
    expect(text).toContain('profile: null');
  });
  it('extracts code block under ## beh.renders in behavior-assertions.md', () => {
    const text = readSection(
      path.join(HARNESS_ROOT, 'prompts/behavior-assertions.md'),
      'beh.renders',
    );
    expect(text).toMatch(/getByRole|toBeInTheDocument/);
  });
  it('returns undefined for missing section', () => {
    expect(readSection(path.join(HARNESS_ROOT, 'prompts/mock-setups.md'), 'pre.nope')).toBeUndefined();
  });
});

describe('buildClosePrompt', () => {
  it('substitutes all the placeholders and computes the expected file path', () => {
    const u = unit({ surface: 'surface.signin', precondition: 'pre.unauthed', behavior: 'beh.renders' });
    const built = buildClosePrompt({
      unit: u,
      surface: surface(),
      precondition: { id: 'pre.unauthed', description: 'unauthed', auth: 'none', resources: [], mock_setup_ref: '' },
      behavior: { id: 'beh.renders', description: 'mounts', assertion_ref: '' },
    });
    expect(built.text).toContain('/signin');
    expect(built.text).toContain('SignInPage');
    expect(built.text).toContain('pre.unauthed');
    expect(built.text).toContain('beh.renders');
    expect(built.text).toContain('mounts');
    expect(built.text).not.toContain('{{');
    expect(built.expectedTestFile).toBe('packages/app/src/SignInPage.beh.renders.test.tsx');
  });

  it('does not leave a leading slash when surface.path is empty', () => {
    const built = buildClosePrompt({
      unit: unit({}),
      surface: surface(),
      precondition: { id: 'pre.unauthed', description: '', auth: 'none', resources: [], mock_setup_ref: '' },
      behavior: { id: 'beh.renders', description: '', assertion_ref: '' },
    });
    expect(built.text).toContain('packages/app/src/SignInPage.beh.renders.test.tsx');
    expect(built.text).not.toContain('packages/app/src//SignInPage');
  });
});

describe('pickGap', () => {
  it('highest-priority returns the lowest-priority-rank GAP', () => {
    const m = manifestOf([
      unit({ id: 'u.p2', priority: 'P2', status: 'GAP' }),
      unit({ id: 'u.p0.b', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.p0.a', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.p1', priority: 'P1', status: 'GAP' }),
    ]);
    expect(pickGap(m, 'highest-priority')?.id).toBe('u.p0.a');
  });

  it('regression-first prefers REGRESSION over GAP', () => {
    const m = manifestOf([
      unit({ id: 'u.gap', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.reg', priority: 'P1', status: 'REGRESSION' }),
    ]);
    expect(pickGap(m, 'regression-first')?.id).toBe('u.reg');
  });

  it('regression-first falls back to highest-priority when no regressions', () => {
    const m = manifestOf([
      unit({ id: 'u.p1', priority: 'P1', status: 'GAP' }),
      unit({ id: 'u.p0', priority: 'P0', status: 'GAP' }),
    ]);
    expect(pickGap(m, 'regression-first')?.id).toBe('u.p0');
  });

  it('fewest-deps prefers gaps with simpler preconditions', () => {
    const m = manifestOf([
      unit({ id: 'u.with-patient', precondition: 'pre.practitioner.with-patient', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.unauthed', precondition: 'pre.unauthed', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.with-project', precondition: 'pre.admin.with-project', priority: 'P0', status: 'GAP' }),
    ]);
    expect(pickGap(m, 'fewest-deps')?.id).toBe('u.unauthed');
  });

  it('random uses the injected rng', () => {
    const m = manifestOf([
      unit({ id: 'u.a', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.b', priority: 'P0', status: 'GAP' }),
      unit({ id: 'u.c', priority: 'P0', status: 'GAP' }),
    ]);
    expect(pickGap(m, 'random', () => 0)?.id).toBe('u.a');
    expect(pickGap(m, 'random', () => 0.99)?.id).toBe('u.c');
  });

  it('returns undefined when no GAP/REGRESSION units exist', () => {
    const m = manifestOf([unit({ status: 'COVERED' })]);
    expect(pickGap(m, 'highest-priority')).toBeUndefined();
  });
});

describe('pickGapById', () => {
  it('returns the unit with the matching id', () => {
    const m = manifestOf([unit({ id: 'u.target' }), unit({ id: 'u.other' })]);
    expect(pickGapById(m, 'u.target')?.id).toBe('u.target');
  });
  it('returns undefined for unknown id', () => {
    const m = manifestOf([unit({ id: 'u.x' })]);
    expect(pickGapById(m, 'u.y')).toBeUndefined();
  });
});

describe('computeDelta', () => {
  it('counts net change in COVERED and PARTIAL', () => {
    const before = manifestOf([
      unit({ id: 'a', status: 'GAP' }),
      unit({ id: 'b', status: 'GAP' }),
      unit({ id: 'c', status: 'COVERED' }),
    ]);
    const after = manifestOf([
      unit({ id: 'a', status: 'COVERED' }),
      unit({ id: 'b', status: 'PARTIAL' }),
      unit({ id: 'c', status: 'COVERED' }),
    ]);
    expect(computeDelta(before, after)).toEqual({ covered: 1, partial: 1 });
  });

  it('reports negative deltas when something regressed', () => {
    const before = manifestOf([unit({ id: 'a', status: 'COVERED' })]);
    const after = manifestOf([unit({ id: 'a', status: 'GAP' })]);
    expect(computeDelta(before, after)).toEqual({ covered: -1, partial: 0 });
  });
});
