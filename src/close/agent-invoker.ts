import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { harnessRoot } from '../util/paths.js';

export interface AgentInvocationResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
}

export interface AgentInvocationOptions {
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  /**
   * Tools the agent is permitted to use. Defaults to ['Write']; the prompt
   * tells the agent to emit the file via Write, and the harness reads it
   * from disk afterwards.
   */
  allowedTools?: string[];
  /**
   * Repo-relative path the agent is expected to Write to. Set as the
   * EXPECTED_TEST_FILE env var on the child process so the
   * agent-context/.claude/hooks/pre-write-fence.sh hook can reject writes
   * to anywhere else.
   */
  expectedTestFile?: string;
  /**
   * Override the path to the agent-context overlay directory. Defaults to
   * <harnessRoot>/agent-context. Tests use this to point at a fixture.
   */
  agentContextDir?: string;
}

/**
 * Invoke `claude` headlessly with the given prompt on stdin and return the
 * captured stdout/stderr plus exit code. The caller is responsible for
 * locating the file the agent wrote (we don't trust stdout to contain it).
 *
 * The harness ships a constrained `.claude/` overlay at
 * <harnessRoot>/agent-context/.claude/ and passes it via --add-dir so the
 * agent loads the constrained settings (Write only) and the pre-write hook
 * that fences writes to EXPECTED_TEST_FILE.
 */
export function invokeAgent(
  options: AgentInvocationOptions,
): Promise<AgentInvocationResult> {
  const agentContextDir =
    options.agentContextDir ?? path.join(harnessRoot(), 'agent-context');

  const args = [
    '--print',
    '--output-format',
    'text',
    '--allowedTools',
    (options.allowedTools ?? ['Write']).join(','),
    '--add-dir',
    agentContextDir,
  ];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.expectedTestFile) {
      env.EXPECTED_TEST_FILE = options.expectedTestFile;
    }
    const child = spawn('claude', args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        durationMs: Date.now() - startedAt,
        exitCode: null,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        exitCode: code,
      });
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
