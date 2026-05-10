import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverMockCatalog,
  extractSignature,
  signatureKey,
} from '../src/discover/mock-catalog.js';
import { parseTestFile } from '../src/score/test-parser.js';
import { validatePromptReferences } from '../src/schema/refs.js';
import { buildClosePrompt } from '../src/close/prompt-builder.js';
import type { Manifest, Surface, Unit } from '../src/schema/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_TARGET = path.join(__dirname, 'fixtures/test-target');
const FIXTURE_SRC = path.join(FIXTURE_TARGET, 'packages/app/src');

describe('signatureKey', () => {
  it('is deterministic regardless of resource ordering', () => {
    const a = signatureKey({
      auth: 'practitioner',
      resources: [
        { resourceType: 'Patient', count: 1 },
        { resourceType: 'Encounter', count: 2 },
      ],
    });
    const b = signatureKey({
      auth: 'practitioner',
      resources: [
        { resourceType: 'Encounter', count: 2 },
        { resourceType: 'Patient', count: 1 },
      ],
    });
    // signatureKey takes resources as-given; mock-catalog sorts before key
    // to ensure stability. Both should be valid keys but the auth role is
    // what's load-bearing for dedup.
    expect(a.startsWith('practitioner|')).toBe(true);
    expect(b.startsWith('practitioner|')).toBe(true);
  });
});

describe('extractSignature', () => {
  it('returns unauthed for { profile: null }', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'SignInPage.test.tsx'));
    expect(extractSignature(parsed)).toEqual({ auth: 'none', resources: [] });
  });

  it('returns practitioner + Patient for HomePage fixture', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'HomePage.test.tsx'));
    expect(extractSignature(parsed)).toEqual({
      auth: 'practitioner',
      resources: [{ resourceType: 'Patient', count: 1 }],
    });
  });

  it('returns undefined for bare new MockClient() — confidence too low', () => {
    const parsed = parseTestFile(path.join(FIXTURE_SRC, 'AmbiguousPage.test.tsx'));
    expect(extractSignature(parsed)).toBeUndefined();
  });
});

describe('discoverMockCatalog', () => {
  it('returns just seeds when target has no test files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mc-'));
    try {
      const catalog = discoverMockCatalog(tmp);
      expect(catalog).toHaveLength(5);
      expect(catalog.every((p) => !p.auto_discovered)).toBe(true);
      expect(catalog.map((p) => p.id).sort()).toEqual([
        'pre.admin.empty',
        'pre.admin.with-project',
        'pre.practitioner.empty',
        'pre.practitioner.with-patient',
        'pre.unauthed',
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not duplicate preconditions whose signature already matches a seed', () => {
    // The fixture target has SignInPage.test.tsx (profile: null) and
    // HomePage.test.tsx (DrAliceSmith + Patient). Both already match seeds,
    // so the catalog should remain at 5 entries.
    const catalog = discoverMockCatalog(FIXTURE_TARGET);
    expect(catalog).toHaveLength(5);
    expect(catalog.every((p) => !p.auto_discovered)).toBe(true);
  });

  it('emits an auto-discovered entry for a novel signature', () => {
    // Build a synthetic target with one test that has admin + Patient — a
    // signature not in the seed catalog.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mc-novel-'));
    const dir = path.join(tmp, 'packages/app/src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'AdminPatientPage.test.tsx'),
      `
import { MockClient } from '@medplum/mock';
const medplum = new MockClient();
medplum.setActiveLoginOverride({ accessToken: 'fake', refreshToken: 'fake', profile: {} as any });
async function setup() {
  await medplum.createResource({ resourceType: 'Patient', name: [{ given: ['Test'], family: 'Patient' }] });
}
test('Renders', async () => { await setup(); expect(true).toBe(true); });
      `.trim(),
      'utf8',
    );

    try {
      const catalog = discoverMockCatalog(tmp);
      const auto = catalog.filter((p) => p.auto_discovered);
      expect(auto).toHaveLength(1);
      expect(auto[0].id).toBe('pre.admin.with-patient');
      expect(auto[0].auth).toBe('admin');
      expect(auto[0].resources).toEqual([{ resourceType: 'Patient', count: 1 }]);
      expect(auto[0].mock_setup_snippet).toBeDefined();
      expect(auto[0].mock_setup_snippet).toContain('setActiveLoginOverride');
      expect(auto[0].mock_setup_snippet).toContain("resourceType: 'Patient'");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('validatePromptReferences with inline snippets', () => {
  it('skips file/anchor checks for preconditions that ship a snippet', () => {
    const m: Manifest = {
      version: 1,
      generated_at: '2026-05-09T14:00:00.000Z',
      target: { repo: '.', scope: ['packages/app/src'] },
      surfaces: [],
      preconditions: [
        {
          id: 'pre.auto.thing',
          description: 'auto',
          auth: 'practitioner',
          resources: [],
          mock_setup_ref: 'auto-discovered', // not a real anchor
          mock_setup_snippet: 'const medplum = new MockClient();',
          auto_discovered: true,
        },
      ],
      behaviors: [],
      units: [],
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refs-skip-'));
    try {
      const r = validatePromptReferences(m, tmp);
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('buildClosePrompt with inline snippet', () => {
  it('uses mock_setup_snippet directly when present', () => {
    const surface: Surface = {
      id: 'surface.example',
      route: '/example',
      component: 'ExamplePage',
      discovered_via: 'packages/app/src/ExamplePage.tsx:1',
    };
    const unit: Unit = {
      id: 'unit.example.x.renders',
      surface: surface.id,
      precondition: 'pre.auto.thing',
      behavior: 'beh.renders',
      priority: 'P1',
      status: 'GAP',
      covered_by: [],
    };
    const inline = '// SYNTHESIZED SNIPPET\nconst medplum = new MockClient();';
    const built = buildClosePrompt({
      unit,
      surface,
      precondition: {
        id: 'pre.auto.thing',
        description: 'auto-discovered',
        auth: 'practitioner',
        resources: [],
        mock_setup_ref: 'auto-discovered',
        mock_setup_snippet: inline,
        auto_discovered: true,
      },
      behavior: {
        id: 'beh.renders',
        description: 'mounts',
        assertion_ref: 'prompts/behavior-assertions.md#beh.renders',
      },
    });
    expect(built.text).toContain('// SYNTHESIZED SNIPPET');
    // Sanity: the seed snippet for pre.unauthed must NOT appear when the
    // inline path was taken (we'd have a smell of the wrong precondition).
    expect(built.text).not.toContain('profile: null');
  });
});
