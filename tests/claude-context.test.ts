import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, '..');
const AGENT_CONTEXT = path.join(HARNESS_ROOT, 'agent-context', '.claude');
const HOOK = path.join(AGENT_CONTEXT, 'hooks', 'pre-write-fence.sh');

function runHook(input: object, env: Record<string, string> = {}): { code: number; stderr: string } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, stderr: r.stderr };
}

describe('agent-context overlay — file integrity', () => {
  it('CLAUDE.md exists and is non-empty', () => {
    const p = path.join(AGENT_CONTEXT, 'CLAUDE.md');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf8').length).toBeGreaterThan(100);
  });

  it('settings.json parses and locks the agent to Write only', () => {
    const p = path.join(AGENT_CONTEXT, 'settings.json');
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(json.permissions.allow).toEqual(['Write']);
    expect(json.permissions.deny).toContain('Edit');
    expect(json.permissions.deny).toContain('Bash(:*)');
    // PreToolUse hook on Write must point at the fence script
    const preWrite = json.hooks.PreToolUse.find(
      (h: { matcher: string }) => h.matcher === 'Write',
    );
    expect(preWrite).toBeDefined();
    expect(preWrite.hooks[0].command).toContain('pre-write-fence.sh');
  });

  it('medplum-test-writing skill is present with frontmatter', () => {
    const p = path.join(AGENT_CONTEXT, 'skills', 'medplum-test-writing', 'SKILL.md');
    const text = fs.readFileSync(p, 'utf8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('name: medplum-test-writing');
    expect(text).toContain('MockClient');
  });

  it('hook script is executable', () => {
    const stat = fs.statSync(HOOK);
    // Owner-execute bit
    expect(stat.mode & 0o100).not.toBe(0);
  });
});

describe('pre-write-fence.sh — semantics', () => {
  const expected = 'packages/app/src/SignInPage.beh.renders.test.tsx';

  it('allows Write to the expected path (exact)', () => {
    const r = runHook(
      { tool_input: { file_path: expected } },
      { EXPECTED_TEST_FILE: expected },
    );
    expect(r.code).toBe(0);
  });

  it('allows Write to the expected path (absolute, ends with expected)', () => {
    const r = runHook(
      { tool_input: { file_path: `/home/u/medplum/${expected}` } },
      { EXPECTED_TEST_FILE: expected },
    );
    expect(r.code).toBe(0);
  });

  it('rejects Write to a different file in the target repo', () => {
    const r = runHook(
      {
        tool_input: {
          file_path: 'packages/app/src/something-else.test.tsx',
        },
      },
      { EXPECTED_TEST_FILE: expected },
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Refusing Write');
    expect(r.stderr).toContain(expected);
  });

  it('rejects Write to package.json (the worst-case clobber)', () => {
    const r = runHook(
      { tool_input: { file_path: 'package.json' } },
      { EXPECTED_TEST_FILE: expected },
    );
    expect(r.code).toBe(2);
  });

  it('allows when EXPECTED_TEST_FILE is unset (out-of-harness invocation)', () => {
    const r = runHook(
      { tool_input: { file_path: 'whatever.tsx' } },
      // explicitly NOT setting EXPECTED_TEST_FILE
      {},
    );
    expect(r.code).toBe(0);
  });

  it('rejects when file_path cannot be extracted', () => {
    const r = runHook(
      { tool_input: {} },
      { EXPECTED_TEST_FILE: expected },
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('could not extract');
  });
});

describe('harness-side .claude/ — file integrity', () => {
  const HARNESS_CLAUDE = path.join(HARNESS_ROOT, '.claude');

  it('settings.json exists and is valid JSON', () => {
    const p = path.join(HARNESS_CLAUDE, 'settings.json');
    expect(fs.existsSync(p)).toBe(true);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(json.permissions.allow).toContain('Bash(npm test)');
    expect(json.permissions.deny).toContain('Bash(rm -rf:*)');
  });

  it('skill, command, and agent files have frontmatter', () => {
    const triples: Array<[string, string]> = [
      [path.join(HARNESS_CLAUDE, 'skills/harness-conventions/SKILL.md'), 'name: harness-conventions'],
      [path.join(HARNESS_CLAUDE, 'commands/scan.md'), 'description:'],
      [path.join(HARNESS_CLAUDE, 'commands/close-gap.md'), 'description:'],
      [path.join(HARNESS_CLAUDE, 'agents/manifest-reviewer.md'), 'name: manifest-reviewer'],
    ];
    for (const [filePath, marker] of triples) {
      expect(fs.existsSync(filePath)).toBe(true);
      const text = fs.readFileSync(filePath, 'utf8');
      expect(text.startsWith('---\n'), `${filePath} missing frontmatter`).toBe(true);
      expect(text, `${filePath} missing marker "${marker}"`).toContain(marker);
    }
  });

  it('root CLAUDE.md exists and references the agent-context overlay', () => {
    const p = path.join(HARNESS_ROOT, 'CLAUDE.md');
    const text = fs.readFileSync(p, 'utf8');
    expect(text).toContain('agent-context/.claude/');
    expect(text).toContain('loop is the point');
  });
});
