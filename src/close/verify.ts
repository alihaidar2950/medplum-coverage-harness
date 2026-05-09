import { spawn } from 'node:child_process';

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
  /** Path to the generated test file, repo-relative or absolute. */
  testFile: string;
  /** Target repo root (e.g. medplum/). Jest is invoked here. */
  targetRepo: string;
  timeoutMs?: number;
}

const COMPILE_FAILURE_PATTERNS = [
  /Test suite failed to run/i,
  /TSError/,
  /SyntaxError/,
  /Cannot find module/,
  /Cannot find name/,
  /Unexpected token/,
  /Could not parse/,
];

export function runVerify(options: VerifyOptions): Promise<VerifyResult> {
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
      const combined = `${stdout}\n${stderr}`;
      const compileFailed = COMPILE_FAILURE_PATTERNS.some((re) => re.test(combined));
      let outcome: VerifyOutcome;
      if (compileFailed) outcome = 'compile-failed';
      else if (code === 0) outcome = 'compile-ok-tests-pass';
      else outcome = 'compile-ok-tests-fail';
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
