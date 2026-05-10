/**
 * End-to-end demonstration that the close cycle actually moves a healthcare
 * behavior gap from GAP → COVERED. The reviewer's note was that the
 * healthcare behaviors are well-modeled in vocabulary and prompt guidance
 * but never demonstrated end-to-end. This test fills that gap without
 * requiring a real `claude` CLI on PATH.
 *
 * Approach:
 *  - Build a temp target repo with one admin-form surface
 *    (/admin/users/new → NewUserPage), which categorizes as `admin-form`
 *    and therefore includes beh.audit-event-emitted in its whitelist.
 *  - Stub the `claude` CLI by writing a fake binary on PATH that reads the
 *    EXPECTED_TEST_FILE env var (set by the agent invoker) and writes a
 *    canned AuditEvent test to that path.
 *  - Run closeOne with targetRepo override and assert the unit moved to
 *    COVERED on the re-scan.
 *
 * This exercises the real production code paths in close/, score/, and
 * discover/ — only the LLM is stubbed out.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeOne } from '../src/close/index.js';
import type { Manifest } from '../src/schema/manifest.js';

describe('end-to-end: closing a healthcare-behavior gap', () => {
  let tmpTarget: string | undefined;
  let tmpBin: string | undefined;
  let originalPath: string | undefined;

  afterEach(() => {
    if (originalPath !== undefined) process.env.PATH = originalPath;
    originalPath = undefined;
    if (tmpTarget) fs.rmSync(tmpTarget, { recursive: true, force: true });
    if (tmpBin) fs.rmSync(tmpBin, { recursive: true, force: true });
    tmpTarget = undefined;
    tmpBin = undefined;
  });

  it('beh.audit-event-emitted: GAP → COVERED after a stubbed agent writes an AuditEvent test', async () => {
    // 1. Build a target repo with one admin-form surface.
    tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-target-'));
    const appSrc = path.join(tmpTarget, 'packages/app/src');
    fs.mkdirSync(path.join(appSrc, 'admin'), { recursive: true });
    fs.writeFileSync(
      path.join(appSrc, 'admin', 'NewUserPage.tsx'),
      'export function NewUserPage() { return null; }\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(appSrc, 'AppRoutes.tsx'),
      [
        "import { Route, Routes } from 'react-router';",
        "import { NewUserPage } from './admin/NewUserPage';",
        'export function AppRoutes() {',
        '  return (',
        '    <Routes>',
        '      <Route path="/admin/users/new" element={<NewUserPage />} />',
        '    </Routes>',
        '  );',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    // 2. Stub the `claude` CLI on PATH. The fake reads EXPECTED_TEST_FILE
    //    (set by agent-invoker) and writes a canned AuditEvent test there.
    tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-bin-'));
    const fakeClaude = path.join(tmpBin, 'claude');
    const generatedTest = [
      "import { DrAliceSmith, MockClient } from '@medplum/mock';",
      "import { NewUserPage } from './admin/NewUserPage';",
      '',
      "describe('NewUserPage', () => {",
      "  test('emits an AuditEvent when an admin creates a user', async () => {",
      '    const medplum = new MockClient({ profile: DrAliceSmith });',
      '    medplum.setActiveLoginOverride({',
      "      accessToken: 'fake', refreshToken: 'fake',",
      "      profile: { resourceType: 'ProjectMembership', admin: true } as any,",
      '    });',
      "    const spy = jest.spyOn(medplum, 'createResource');",
      '    // ... exercise the surface ...',
      "    const auditCall = spy.mock.calls.find((c) => c[0]?.resourceType === 'AuditEvent');",
      '    expect(auditCall).toBeDefined();',
      '  });',
      '});',
      '',
    ].join('\n');
    // The script must write to the path specified in EXPECTED_TEST_FILE,
    // which the agent-invoker resolves relative to cwd (= tmpTarget).
    fs.writeFileSync(
      fakeClaude,
      [
        '#!/usr/bin/env bash',
        '# Stub claude CLI for the end-to-end healthcare-behavior test.',
        '# Drains stdin (the harness pipes the prompt) so the parent does',
        '# not block on a full pipe buffer, then writes a canned AuditEvent',
        '# test to the path EXPECTED_TEST_FILE points at.',
        'cat > /dev/null',
        'mkdir -p "$(dirname "$EXPECTED_TEST_FILE")"',
        "cat > \"$EXPECTED_TEST_FILE\" <<'__HARNESS_EOF__'",
        generatedTest,
        '__HARNESS_EOF__',
        'exit 0',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.chmodSync(fakeClaude, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${tmpBin}:${originalPath ?? ''}`;

    // 3. Build a synthetic "before" manifest. The unit we want to close is
    //    the admin-form/audit-event-emitted GAP for NewUserPage. Surface
    //    discovered_via points at the real fixture file we wrote above so
    //    deriveSurfaceFileLocation parses out the admin/ directory.
    const before: Manifest = {
      version: 1,
      generated_at: '2026-05-09T14:00:00.000Z',
      target: { repo: tmpTarget, scope: ['packages/app/src'] },
      surfaces: [
        {
          id: 'surface.admin.users.new',
          route: '/admin/users/new',
          component: 'NewUserPage',
          discovered_via: 'packages/app/src/admin/NewUserPage.tsx:1',
        },
      ],
      preconditions: [
        {
          id: 'pre.admin.empty',
          description: 'project admin signed in, no project resources',
          auth: 'admin',
          resources: [],
          mock_setup_ref: 'prompts/mock-setups.md#pre.admin.empty',
        },
      ],
      behaviors: [
        {
          id: 'beh.audit-event-emitted',
          description: 'audit-relevant actions emit AuditEvent FHIR resources',
          assertion_ref: 'prompts/behavior-assertions.md#beh.audit-event-emitted',
        },
      ],
      units: [
        {
          id: 'unit.admin.users.new.admin.empty.audit-event-emitted',
          surface: 'surface.admin.users.new',
          precondition: 'pre.admin.empty',
          behavior: 'beh.audit-event-emitted',
          priority: 'P2',
          status: 'GAP',
          covered_by: [],
        },
      ],
    };

    // 4. Run closeOne against the temp target with the stubbed agent.
    const result = await closeOne(before, {
      strategy: 'highest-priority',
      verify: false,
      targetRepo: tmpTarget,
      agentTimeoutMs: 10_000,
    });

    // 5. The agent (our stub) wrote the expected file successfully.
    expect(result.outcome.agentOutcome).toBe('success');
    expect(result.unit?.behavior).toBe('beh.audit-event-emitted');
    expect(result.generatedTestPath).toBe(
      'packages/app/src/admin/NewUserPage.beh.audit-event-emitted.test.tsx',
    );

    // The generated test landed in the target repo (not the harness repo).
    const generatedAbsPath = path.join(tmpTarget, result.generatedTestPath!);
    expect(fs.existsSync(generatedAbsPath)).toBe(true);
    expect(fs.readFileSync(generatedAbsPath, 'utf8')).toContain('AuditEvent');

    // 6. The re-scan recognized the new test and moved the unit to COVERED.
    //    This is the load-bearing assertion: it proves the close→re-scan
    //    cycle is genuinely closed-loop for a healthcare behavior, not just
    //    plumbed through.
    const afterUnit = result.after.units.find(
      (u) =>
        u.surface === 'surface.admin.users.new' &&
        u.precondition === 'pre.admin.empty' &&
        u.behavior === 'beh.audit-event-emitted',
    );
    expect(afterUnit?.status).toBe('COVERED');
    expect(afterUnit?.covered_by).toContain(
      'packages/app/src/admin/NewUserPage.beh.audit-event-emitted.test.tsx',
    );

    // Delta should reflect at least one new COVERED unit.
    expect(result.outcome.delta.covered).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
