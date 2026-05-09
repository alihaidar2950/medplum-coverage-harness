import type { Manifest, Unit } from '../schema/manifest.js';

export type StopReason =
  | 'p0-gaps==0'
  | 'regressions==0'
  | 'coverage>=N%'
  | 'delta-stalled'
  | 'iterations>=N'
  | 'budget-exceeded'
  | 'failures>=N'
  | 'quality-decay';

export interface StopCheck {
  shouldStop: boolean;
  reason?: StopReason;
  isGuardrail: boolean;
}

/**
 * One condition the user can pass via --until. Internally we accept
 * the raw string forms ("p0-gaps==0", "regressions==0", "coverage>=50%",
 * "delta-stalled") and keep their parsed shape.
 */
export type UntilCondition =
  | { kind: 'p0-gaps==0' }
  | { kind: 'regressions==0' }
  | { kind: 'coverage>=N%'; threshold: number }
  | { kind: 'delta-stalled' };

export interface IterationRecord {
  n: number;
  started_at: string;
  gap_picked: string;
  gap_priority: string;
  agent_duration_ms: number;
  agent_outcome: 'success' | 'failure';
  verify_outcome?:
    | 'compile-ok-tests-pass'
    | 'compile-ok-tests-fail'
    | 'compile-failed'
    | 'not-run';
  delta: { covered: number; partial: number };
}

export interface LoopConfig {
  iterationsMax: number;
  budgetMinutes: number;
  maxFailures: number;
  until: UntilCondition[];
  verify: boolean;
  startedAt: number;
}

export function parseUntil(raw: string): UntilCondition {
  const s = raw.replace(/\s+/g, '');
  if (s === 'p0-gaps==0') return { kind: 'p0-gaps==0' };
  if (s === 'regressions==0') return { kind: 'regressions==0' };
  if (s === 'delta-stalled') return { kind: 'delta-stalled' };
  const m = /^coverage>=(\d+(?:\.\d+)?)%?$/.exec(s);
  if (m) return { kind: 'coverage>=N%', threshold: Number(m[1]) };
  throw new Error(`Unknown --until condition: ${raw}`);
}

function countByStatus(units: Unit[]): Record<string, number> {
  const counts: Record<string, number> = {
    COVERED: 0,
    PARTIAL: 0,
    GAP: 0,
    REGRESSION: 0,
    IGNORED: 0,
  };
  for (const u of units) counts[u.status] = (counts[u.status] ?? 0) + 1;
  return counts;
}

function p0Gaps(units: Unit[]): number {
  return units.filter(
    (u) => u.priority === 'P0' && (u.status === 'GAP' || u.status === 'REGRESSION'),
  ).length;
}

function regressions(units: Unit[]): number {
  return units.filter((u) => u.status === 'REGRESSION').length;
}

function coveragePct(units: Unit[]): number {
  const eligible = units.filter((u) => u.status !== 'IGNORED');
  if (eligible.length === 0) return 100;
  const covered = eligible.filter((u) => u.status === 'COVERED').length;
  return (covered * 100) / eligible.length;
}

function netClosures(rec: IterationRecord): number {
  return rec.delta.covered;
}

function isDeltaStalled(history: IterationRecord[]): boolean {
  if (history.length < 3) return false;
  const last3 = history.slice(-3);
  return last3.every((r) => netClosures(r) <= 0);
}

function verifySuccessRateBelowFifty(history: IterationRecord[]): boolean {
  // Only meaningful once we have 5 iterations with a verify outcome
  const withVerify = history.filter(
    (r) => r.verify_outcome && r.verify_outcome !== 'not-run',
  );
  if (withVerify.length < 5) return false;
  const last5 = withVerify.slice(-5);
  const successes = last5.filter(
    (r) =>
      r.verify_outcome === 'compile-ok-tests-pass' ||
      r.verify_outcome === 'compile-ok-tests-fail',
  ).length;
  return successes / last5.length < 0.5;
}

function consecutiveFailures(history: IterationRecord[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    const compileFail = r.verify_outcome === 'compile-failed';
    if (r.agent_outcome === 'failure' || compileFail) {
      n++;
    } else {
      break;
    }
  }
  return n;
}

/**
 * Evaluate stopping conditions. Order matters:
 *   1. Guardrails first (iteration cap, budget, failures, quality-decay)
 *   2. Then user --until conditions (OR'd)
 *
 * Returns the first match.
 */
export function evaluateStoppingConditions(
  manifest: Manifest,
  history: IterationRecord[],
  config: LoopConfig,
  now: number = Date.now(),
): StopCheck {
  // --- Guardrails (always-on safety limits) ---
  if (history.length >= config.iterationsMax) {
    return { shouldStop: true, reason: 'iterations>=N', isGuardrail: true };
  }
  const elapsedMs = now - config.startedAt;
  if (elapsedMs >= config.budgetMinutes * 60_000) {
    return { shouldStop: true, reason: 'budget-exceeded', isGuardrail: true };
  }
  if (consecutiveFailures(history) >= config.maxFailures) {
    return { shouldStop: true, reason: 'failures>=N', isGuardrail: true };
  }
  if (config.verify && verifySuccessRateBelowFifty(history)) {
    return { shouldStop: true, reason: 'quality-decay', isGuardrail: true };
  }

  // --- User-supplied --until conditions (OR'd) ---
  for (const cond of config.until) {
    switch (cond.kind) {
      case 'p0-gaps==0':
        if (p0Gaps(manifest.units) === 0) {
          return { shouldStop: true, reason: 'p0-gaps==0', isGuardrail: false };
        }
        break;
      case 'regressions==0':
        if (regressions(manifest.units) === 0) {
          return { shouldStop: true, reason: 'regressions==0', isGuardrail: false };
        }
        break;
      case 'coverage>=N%':
        if (coveragePct(manifest.units) >= cond.threshold) {
          return { shouldStop: true, reason: 'coverage>=N%', isGuardrail: false };
        }
        break;
      case 'delta-stalled':
        if (isDeltaStalled(history)) {
          return { shouldStop: true, reason: 'delta-stalled', isGuardrail: false };
        }
        break;
    }
  }

  return { shouldStop: false, isGuardrail: false };
}

// Exposed for tests / reporters
export const internals = {
  countByStatus,
  p0Gaps,
  regressions,
  coveragePct,
  consecutiveFailures,
  isDeltaStalled,
  verifySuccessRateBelowFifty,
};
