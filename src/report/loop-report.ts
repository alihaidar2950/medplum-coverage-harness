import type { LoopLog } from '../loop/iteration-logger.js';
import type { IterationRecord } from '../loop/stopping-conditions.js';

export function renderLoopReport(log: LoopLog): string {
  const lines: string[] = [];

  lines.push(`# Loop Report`);
  lines.push('');
  lines.push(`- **Started:** ${log.started_at}`);
  if (log.stopped_at) lines.push(`- **Stopped:** ${log.stopped_at}`);
  if (log.stopped_because) {
    const tag = log.stopped_by_guardrail ? 'guardrail' : 'goal';
    lines.push(`- **Stopped because:** \`${log.stopped_because}\` (${tag})`);
  }
  lines.push(`- **Iterations run:** ${log.iterations.length}`);
  lines.push('');

  lines.push(`## Configuration`);
  lines.push('');
  lines.push(`- **Iterations cap:** ${log.config.iterations_max}`);
  lines.push(`- **Budget:** ${log.config.budget_minutes} min`);
  lines.push(`- **Max failures:** ${log.config.max_failures}`);
  lines.push(`- **Strategy:** ${log.config.strategy}`);
  lines.push(`- **Until:** ${log.config.until.length > 0 ? log.config.until.map((u) => `\`${u}\``).join(', ') : '_none_'}`);
  lines.push(`- **Verify:** ${log.config.verify ? 'on' : 'off'}`);
  lines.push('');

  lines.push(`## Aggregate`);
  lines.push('');
  const totalCovered = sum(log.iterations, (r) => r.delta.covered);
  const totalPartial = sum(log.iterations, (r) => r.delta.partial);
  const agentSuccesses = log.iterations.filter((r) => r.agent_outcome === 'success').length;
  const agentFailures = log.iterations.filter((r) => r.agent_outcome === 'failure').length;
  const verifyOutcomes = countVerifyOutcomes(log.iterations);
  lines.push(`- **Net coverage delta:** covered ${signed(totalCovered)}, partial ${signed(totalPartial)}`);
  lines.push(`- **Agent:** ${agentSuccesses} success / ${agentFailures} failure`);
  if (log.config.verify && log.iterations.length > 0) {
    const v = verifyOutcomes;
    lines.push(
      `- **Verify:** ${v['compile-ok-tests-pass']} pass / ${v['compile-ok-tests-fail']} test-fail / ${v['compile-failed']} compile-fail / ${v['not-run']} not-run`,
    );
  }
  const totalDuration = sum(log.iterations, (r) => r.agent_duration_ms);
  lines.push(`- **Total agent time:** ${formatMs(totalDuration)}`);
  lines.push('');

  if (log.iterations.length > 0) {
    lines.push(`## Iterations`);
    lines.push('');
    const headers = ['#', 'Gap', 'Pri', 'Agent', 'Verify', 'Δcovered', 'Δpartial', 'Duration'];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const r of log.iterations) {
      const verify = r.verify_outcome ?? '—';
      lines.push(
        `| ${r.n} | \`${r.gap_picked}\` | ${r.gap_priority} | ${r.agent_outcome} | ${verify} | ${signed(r.delta.covered)} | ${signed(r.delta.partial)} | ${formatMs(r.agent_duration_ms)} |`,
      );
    }
    lines.push('');
  }

  if (log.stopped_because) {
    lines.push(`## Why we stopped`);
    lines.push('');
    lines.push(stopReasonExplanation(log));
    lines.push('');
  }

  return lines.join('\n');
}

function sum<T>(arr: T[], f: (t: T) => number): number {
  let n = 0;
  for (const x of arr) n += f(x);
  return n;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function countVerifyOutcomes(iters: IterationRecord[]): Record<string, number> {
  const c: Record<string, number> = {
    'compile-ok-tests-pass': 0,
    'compile-ok-tests-fail': 0,
    'compile-failed': 0,
    'not-run': 0,
  };
  for (const r of iters) {
    if (r.verify_outcome) c[r.verify_outcome] = (c[r.verify_outcome] ?? 0) + 1;
  }
  return c;
}

function stopReasonExplanation(log: LoopLog): string {
  const reason = log.stopped_because ?? '';
  switch (reason) {
    case 'p0-gaps==0':
      return 'All P0 gaps closed — the loop met its goal and stopped.';
    case 'regressions==0':
      return 'All regressions resolved — the loop met its goal and stopped.';
    case 'coverage>=N%':
      return 'Coverage threshold met — the loop met its goal and stopped.';
    case 'delta-stalled':
      return 'Three iterations in a row produced zero net closures. The loop stalled and stopped to avoid wasting budget.';
    case 'iterations>=N':
      return `Iteration cap reached (${log.config.iterations_max}). This is a guardrail; raise --iterations only if the loop was making real progress when it hit the cap.`;
    case 'budget-exceeded':
      return `Wall-clock budget (${log.config.budget_minutes} min) exceeded. Guardrail. Re-run with a larger --budget if needed.`;
    case 'failures>=N':
      return `Consecutive failure cap reached (${log.config.max_failures}). Guardrail. Inspect the failures in the iterations table; the agent is producing bad output or the test file isn't landing where expected.`;
    case 'quality-decay':
      return 'Verify success rate dropped below 50% over the last 5 iterations. Guardrail. The agent is producing tests that fail to compile too often; investigate before continuing.';
    default:
      return `Stopped: \`${reason}\`.`;
  }
}
