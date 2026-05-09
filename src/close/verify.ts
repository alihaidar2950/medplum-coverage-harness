import { spawn } from 'node:child_process';
import { logger } from '../util/logger.js';

export type VerifyOutcome =
  | 'compile-ok-tests-pass'
  | 'compile-ok-tests-fail'
  | 'compile-failed'
  | 'not-run';

export interface VerifyResult {
  outcome: VerifyOutcome;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface VerifyOptions {
  /** Path to the generated test file, relative to or under targetRepo. */
  testFile: string;
  /** Target repo cwd (medplum root). */
  targetRepo: string;
  timeoutMs?: number;
}

/**
 * Spawn `npx jest <file>` in the target repo. Working spawn boilerplate;
 * the outcome classifier (compile-failed vs tests-fail vs tests-pass) is
 * the TODO — needs Jest stderr/stdout heuristics.
 */
export function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  logger.warn('TODO: result parsing for verify');

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('npx', ['jest', options.testFile], {
      cwd: options.targetRepo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    }

    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        outcome: 'compile-failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      // TODO: real classifier. For now, exit 0 → tests-pass, non-zero → tests-fail.
      const outcome: VerifyOutcome =
        code === 0 ? 'compile-ok-tests-pass' : 'compile-ok-tests-fail';
      resolve({
        outcome,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}
