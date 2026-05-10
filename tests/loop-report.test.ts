import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderLoopReport } from '../src/report/loop-report.js';
import { runLoop } from '../src/loop/index.js';
import type { LoopLog } from '../src/loop/iteration-logger.js';
import type { CloseOutcome } from '../src/close/index.js';
import type { Manifest } from '../src/schema/manifest.js';

function emptyManifest(): Manifest {
  return {
    version: 1,
    generated_at: '2026-05-09T14:00:00.000Z',
    target: { repo: '../medplum', scope: ['packages/app/src'] },
    surfaces: [],
    preconditions: [],
    behaviors: [],
    units: [],
  };
}

function fakeLog(over: Partial<LoopLog> = {}): LoopLog {
  return {
    started_at: '2026-05-09T14:00:00.000Z',
    config: {
      iterations_max: 10,
      until: ['p0-gaps==0', 'delta-stalled'],
      strategy: 'highest-priority',
      budget_minutes: 30,
      max_failures: 3,
      verify: true,
    },
    iterations: [
      {
        n: 1,
        started_at: '2026-05-09T14:00:01.000Z',
        gap_picked: 'unit.signin.unauthed.renders',
        gap_priority: 'P0',
        agent_duration_ms: 47000,
        agent_outcome: 'success',
        verify_outcome: 'compile-ok-tests-pass',
        delta: { covered: 1, partial: 0 },
      },
      {
        n: 2,
        started_at: '2026-05-09T14:01:00.000Z',
        gap_picked: 'unit.home.practitioner.empty.renders',
        gap_priority: 'P0',
        agent_duration_ms: 52000,
        agent_outcome: 'success',
        verify_outcome: 'compile-ok-tests-fail',
        delta: { covered: 1, partial: 0 },
      },
    ],
    stopped_at: '2026-05-09T14:08:00.000Z',
    stopped_because: 'p0-gaps==0',
    stopped_by_guardrail: false,
    ...over,
  };
}

describe('renderLoopReport', () => {
  it('renders a complete log with goal stop', () => {
    const out = renderLoopReport(fakeLog());
    expect(out).toContain('# Loop Report');
    expect(out).toContain('p0-gaps==0');
    expect(out).toContain('(goal)');
    expect(out).toContain('Iterations run:** 2');
    expect(out).toContain('unit.signin.unauthed.renders');
    expect(out).toContain('unit.home.practitioner.empty.renders');
    // aggregate covered = +1 +1 = +2
    expect(out).toContain('covered +2');
    // verify breakdown
    expect(out).toContain('1 pass / 1 test-fail');
    // duration formatted
    expect(out).toContain('47.0s');
  });

  it('explains guardrail stops differently than goal stops', () => {
    const out = renderLoopReport(
      fakeLog({ stopped_because: 'budget-exceeded', stopped_by_guardrail: true }),
    );
    expect(out).toContain('(guardrail)');
    expect(out).toContain('Wall-clock budget');
  });

  it('handles quality-decay reason with the right explanation', () => {
    const out = renderLoopReport(
      fakeLog({ stopped_because: 'quality-decay', stopped_by_guardrail: true }),
    );
    expect(out).toContain('Verify success rate dropped below 50%');
  });

  it('handles delta-stalled', () => {
    const out = renderLoopReport(
      fakeLog({ stopped_because: 'delta-stalled', stopped_by_guardrail: false }),
    );
    expect(out).toContain('zero net closures');
  });

  it('handles a log with no iterations gracefully', () => {
    const out = renderLoopReport(fakeLog({ iterations: [], stopped_because: 'p0-gaps==0' }));
    expect(out).toContain('Iterations run:** 0');
    expect(out).not.toContain('## Iterations\n\n|'); // no table when empty
  });

  it('uses signed integers for deltas', () => {
    const out = renderLoopReport(
      fakeLog({
        iterations: [
          {
            n: 1,
            started_at: 'x',
            gap_picked: 'u.x',
            gap_priority: 'P0',
            agent_duration_ms: 1000,
            agent_outcome: 'failure',
            verify_outcome: 'compile-failed',
            delta: { covered: 0, partial: 0 },
          },
        ],
      }),
    );
    expect(out).toContain('| 0 | 0 |');
  });
});

describe('runLoop writes a markdown report', () => {
  it('produces reports/loop-<ts>.md alongside the iteration log', async () => {
    // Run the loop with a stub close that flips one P0 GAP to COVERED, plus
    // an --until that fires immediately on the second scan.
    const manifestWithGap: Manifest = {
      ...emptyManifest(),
      units: [
        {
          id: 'unit.x',
          surface: 'surface.x',
          precondition: 'pre.x',
          behavior: 'beh.renders',
          priority: 'P0',
          status: 'GAP',
          covered_by: [],
        },
      ],
    };
    const manifestClosed: Manifest = {
      ...manifestWithGap,
      units: [{ ...manifestWithGap.units[0], status: 'COVERED' }],
    };

    let scans = 0;
    const result = await runLoop(
      {
        iterations: 5,
        until: ['p0-gaps==0'],
        strategy: 'highest-priority',
        budgetMinutes: 30,
        maxFailures: 3,
        verify: false,
      },
      {
        scan: async () => (scans++ === 0 ? manifestWithGap : manifestClosed),
        close: async (): Promise<CloseOutcome> => ({
          gapPicked: 'unit.x',
          gapPriority: 'P0',
          agentOutcome: 'success',
          delta: { covered: 1, partial: 0 },
        }),
      },
    );

    expect(result.stoppedBecause).toBe('p0-gaps==0');
    expect(result.iterationsRun).toBe(1);
    expect(fs.existsSync(result.reportPath)).toBe(true);
    const md = fs.readFileSync(result.reportPath, 'utf8');
    expect(md).toContain('# Loop Report');
    expect(md).toContain('p0-gaps==0');
    expect(md).toContain('unit.x');
    // Cleanup so we don't pollute reports/
    fs.rmSync(result.reportPath, { force: true });
    fs.rmSync(result.logPath, { force: true });
  });
});
