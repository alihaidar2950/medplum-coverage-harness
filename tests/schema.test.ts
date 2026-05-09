import { describe, it, expect } from 'vitest';
import {
  parseManifest,
  ManifestValidationError,
  type Manifest,
} from '../src/schema/manifest.js';

const baseManifest: Manifest = {
  version: 1,
  generated_at: '2026-05-09T14:00:00.000Z',
  target: { repo: '../medplum', scope: ['packages/app/src'] },
  surfaces: [
    {
      id: 'surface.signin',
      route: '/signin',
      component: 'SignInPage',
      discovered_via: 'AppRoutes.tsx',
    },
  ],
  preconditions: [
    {
      id: 'pre.unauthed',
      description: 'unauthenticated MockClient',
      auth: 'none',
      resources: [],
      mock_setup_ref: 'mock-setups.md#pre.unauthed',
    },
  ],
  behaviors: [
    {
      id: 'beh.renders',
      description: 'component mounts',
      assertion_ref: 'behavior-assertions.md#beh.renders',
    },
  ],
  units: [
    {
      id: 'unit.signin.unauthed.renders',
      surface: 'surface.signin',
      precondition: 'pre.unauthed',
      behavior: 'beh.renders',
      priority: 'P0',
      status: 'GAP',
      covered_by: [],
    },
  ],
};

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    expect(() => parseManifest(baseManifest)).not.toThrow();
  });

  it('rejects when unit.surface points to an unknown surface', () => {
    const bad = structuredClone(baseManifest);
    bad.units[0].surface = 'surface.does-not-exist';
    expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
  });

  it('rejects when unit.precondition points to an unknown precondition', () => {
    const bad = structuredClone(baseManifest);
    bad.units[0].precondition = 'pre.does-not-exist';
    expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
  });

  it('rejects when unit.behavior points to an unknown behavior', () => {
    const bad = structuredClone(baseManifest);
    bad.units[0].behavior = 'beh.renders';
    bad.behaviors = [];
    expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
  });

  it('rejects IGNORED unit without notes', () => {
    const bad = structuredClone(baseManifest);
    bad.units[0].status = 'IGNORED';
    bad.units[0].notes = undefined;
    expect(() => parseManifest(bad)).toThrow();
  });

  it('accepts IGNORED unit with notes', () => {
    const ok = structuredClone(baseManifest);
    ok.units[0].status = 'IGNORED';
    ok.units[0].notes = 'covered by E2E suite';
    expect(() => parseManifest(ok)).not.toThrow();
  });

  it('rejects bad surface id format', () => {
    const bad = structuredClone(baseManifest);
    bad.surfaces[0].id = 'signin';
    bad.units[0].surface = 'signin';
    expect(() => parseManifest(bad)).toThrow();
  });
});
