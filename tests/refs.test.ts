import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validatePromptReferences } from '../src/schema/refs.js';
import type { Manifest } from '../src/schema/manifest.js';

function makeFixture(): { rootDir: string; cleanup: () => void } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refs-'));
  const promptsDir = path.join(rootDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });

  fs.writeFileSync(
    path.join(promptsDir, 'mock-setups.md'),
    [
      '# mocks',
      '',
      '## pre.unauthed',
      '',
      '```ts',
      'const medplum = new MockClient({ profile: null });',
      '```',
      '',
      '## pre.broken-no-fence',
      '',
      'no code block here',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(promptsDir, 'behavior-assertions.md'),
    [
      '## beh.renders',
      '',
      '```',
      'expect(getByRole("heading")).toBeInTheDocument()',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );

  return { rootDir, cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }) };
}

function manifestWith(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    generated_at: '2026-05-09T14:00:00.000Z',
    target: { repo: '../medplum', scope: ['packages/app/src'] },
    surfaces: [],
    preconditions: [
      {
        id: 'pre.unauthed',
        description: '',
        auth: 'none',
        resources: [],
        mock_setup_ref: 'prompts/mock-setups.md#pre.unauthed',
      },
    ],
    behaviors: [
      {
        id: 'beh.renders',
        description: '',
        assertion_ref: 'prompts/behavior-assertions.md#beh.renders',
      },
    ],
    units: [],
    ...overrides,
  };
}

describe('validatePromptReferences', () => {
  it('passes when every ref points to an existing section with a code block', () => {
    const { rootDir, cleanup } = makeFixture();
    try {
      const r = validatePromptReferences(manifestWith(), rootDir);
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('fails when the referenced anchor is missing', () => {
    const { rootDir, cleanup } = makeFixture();
    try {
      const m = manifestWith({
        preconditions: [
          {
            id: 'pre.x',
            description: '',
            auth: 'none',
            resources: [],
            mock_setup_ref: 'prompts/mock-setups.md#pre.does-not-exist',
          },
        ],
      });
      const r = validatePromptReferences(m, rootDir);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('pre.does-not-exist');
      expect(r.errors[0]).toContain('not found');
    } finally {
      cleanup();
    }
  });

  it('fails when the section exists but has no code block', () => {
    const { rootDir, cleanup } = makeFixture();
    try {
      const m = manifestWith({
        preconditions: [
          {
            id: 'pre.broken-no-fence',
            description: '',
            auth: 'none',
            resources: [],
            mock_setup_ref: 'prompts/mock-setups.md#pre.broken-no-fence',
          },
        ],
      });
      const r = validatePromptReferences(m, rootDir);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('no code block');
    } finally {
      cleanup();
    }
  });

  it('fails when the referenced file does not exist', () => {
    const { rootDir, cleanup } = makeFixture();
    try {
      const m = manifestWith({
        behaviors: [
          {
            id: 'beh.renders',
            description: '',
            assertion_ref: 'prompts/missing-file.md#beh.renders',
          },
        ],
      });
      const r = validatePromptReferences(m, rootDir);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('does not exist');
    } finally {
      cleanup();
    }
  });

  it('rejects malformed refs', () => {
    const { rootDir, cleanup } = makeFixture();
    try {
      const m = manifestWith({
        preconditions: [
          {
            id: 'pre.bad',
            description: '',
            auth: 'none',
            resources: [],
            mock_setup_ref: 'no-anchor-here',
          },
        ],
      });
      const r = validatePromptReferences(m, rootDir);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('malformed');
    } finally {
      cleanup();
    }
  });

  it('passes against the real prompts/ directory', () => {
    // The shipped manifest catalog should validate cleanly against the
    // shipped prompt files. This catches drift between catalog ids and
    // markdown anchors at test time, not at agent-invocation time.
    const harnessRoot = path.resolve(__dirname, '..');
    const m = manifestWith({
      preconditions: [
        { id: 'pre.unauthed', description: '', auth: 'none', resources: [], mock_setup_ref: 'prompts/mock-setups.md#pre.unauthed' },
        { id: 'pre.practitioner.empty', description: '', auth: 'practitioner', resources: [], mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.empty' },
        { id: 'pre.practitioner.with-patient', description: '', auth: 'practitioner', resources: [], mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.with-patient' },
        { id: 'pre.admin.empty', description: '', auth: 'admin', resources: [], mock_setup_ref: 'prompts/mock-setups.md#pre.admin.empty' },
        { id: 'pre.admin.with-project', description: '', auth: 'admin', resources: [], mock_setup_ref: 'prompts/mock-setups.md#pre.admin.with-project' },
      ],
      behaviors: [
        { id: 'beh.renders', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.renders' },
        { id: 'beh.list-displayed', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.list-displayed' },
        { id: 'beh.form-submit-success', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.form-submit-success' },
        { id: 'beh.form-validation-error', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.form-validation-error' },
        { id: 'beh.navigates', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.navigates' },
        { id: 'beh.empty-state', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.empty-state' },
        { id: 'beh.error-state', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.error-state' },
        { id: 'beh.phi-masked', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.phi-masked' },
        { id: 'beh.audit-event-emitted', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.audit-event-emitted' },
        { id: 'beh.consent-honored', description: '', assertion_ref: 'prompts/behavior-assertions.md#beh.consent-honored' },
      ],
    });
    const r = validatePromptReferences(m, harnessRoot);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
