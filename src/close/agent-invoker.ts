import { spawn } from 'node:child_process';
import { logger } from '../util/logger.js';

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
}

/**
 * Invoke `claude` headlessly. Working spawn boilerplate; the surrounding
 * orchestration (prompt-building, finding the produced file, verifying the
 * path matches the expected gap) is the TODO.
 */
export function invokeAgent(
  options: AgentInvocationOptions,
): Promise<AgentInvocationResult> {
  logger.warn('TODO: prompt building / output capture for agent invoker');

  const args = [
    '--print',
    '--output-format',
    'text',
    '--allowedTools',
    (options.allowedTools ?? ['Write']).join(','),
  ];

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('claude', args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
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
