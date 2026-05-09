import { describe, it, expect } from 'vitest';
import {
  evaluateStoppingConditions,
  parseUntil,
  type IterationRecord,
  type LoopConfig,
} from '../src/loop/stopping-conditions.js';
import type { Manifest, Unit } from '../src/schema/manifest.js';

function makeUnit(overrides: Partial<Unit>): Unit {
  return {
    id: 'unit.x',
    surface: 'surface.x',
    precondition: 'pre.x',
    behavior: 'beh.renders',
    priority: 'P1',
    status: 'COVERED',
    covered_by: [],
    ...overrides,
  };
}

function manifestOf(units: Unit[]): Manifest {
  return {
    version: 1,
    generated_at: '2026-05-09T14:00:00.000Z',
    target: { repo: '../medplum', scope: ['packages/app/src'] },
    surfaces: [],
    preconditions: [],
    behaviors: [],
    units,
  };
}

function baseConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    iterationsMax: 10,
    budgetMinutes: 30,
    maxFailures: 3,
    until: [],
    verify: false,
    startedAt: 1_000_000,
    ...overrides,
  };
}

function rec(over: Partial<IterationRecord> = {}): IterationRecord {
  return {
    n: 1,
    started_at: '2026-05-09T14:00:01.000Z',
    gap_picked: 'unit.x',
    gap_priority: 'P1',
    agent_duration_ms: 1000,
    agent_outcome: 'success',
    delta: { covered: 1, partial: 0 },
    ...over,
  };
}

describe('parseUntil', () => {
  it('parses each known form', () => {
    expect(parseUntil('p0-gaps==0')).toEqual({ kind: 'p0-gaps==0' });
    expect(parseUntil('regressions==0')).toEqual({ kind: 'regressions==0' });
    expect(parseUntil('delta-stalled')).toEqual({ kind: 'delta-stalled' });
    expect(parseUntil('coverage>=50%')).toEqual({ kind: 'coverage>=N%', threshold: 50 });
    expect(parseUntil('coverage >= 75')).toEqual({ kind: 'coverage>=N%', threshold: 75 });
  });

  it('rejects unknown forms', () => {
    expect(() => parseUntil('something-else')).toThrow();
  });
});

describe('evaluateStoppingConditions — guardrails (always on)', () => {
  it('stops on iterations>=N', () => {
    const cfg = baseConfig({ iterationsMax: 2 });
    const history = [rec(), rec({ n: 2 })];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r).toEqual({ shouldStop: true, reason: 'iterations>=N', isGuardrail: true });
  });

  it('stops on budget-exceeded', () => {
    const cfg = baseConfig({ budgetMinutes: 1, startedAt: 0 });
    const r = evaluateStoppingConditions(manifestOf([]), [], cfg, 60_001);
    expect(r).toEqual({ shouldStop: true, reason: 'budget-exceeded', isGuardrail: true });
  });

  it('stops on consecutive failures>=N', () => {
    const cfg = baseConfig({ maxFailures: 2 });
    const history = [
      rec({ agent_outcome: 'failure' }),
      rec({ n: 2, agent_outcome: 'failure' }),
    ];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r).toEqual({ shouldStop: true, reason: 'failures>=N', isGuardrail: true });
  });

  it('counts compile-failed verify outcomes as failures', () => {
    const cfg = baseConfig({ maxFailures: 2 });
    const history = [
      rec({ agent_outcome: 'success', verify_outcome: 'compile-failed' }),
      rec({ n: 2, agent_outcome: 'success', verify_outcome: 'compile-failed' }),
    ];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r.reason).toBe('failures>=N');
    expect(r.isGuardrail).toBe(true);
  });

  it('resets failure streak on a clean iteration', () => {
    const cfg = baseConfig({ maxFailures: 2 });
    const history = [
      rec({ agent_outcome: 'failure' }),
      rec({ n: 2, agent_outcome: 'success' }),
      rec({ n: 3, agent_outcome: 'failure' }),
    ];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r.shouldStop).toBe(false);
  });

  it('quality-decay only triggers when --verify is on AND last 5 verify outcomes <50% success', () => {
    const cfg = baseConfig({ verify: true });
    const history: IterationRecord[] = [
      rec({ n: 1, verify_outcome: 'compile-failed' }),
      rec({ n: 2, verify_outcome: 'compile-failed' }),
      rec({ n: 3, verify_outcome: 'compile-failed' }),
      rec({ n: 4, verify_outcome: 'compile-ok-tests-pass' }),
      rec({ n: 5, verify_outcome: 'compile-ok-tests-pass' }),
    ];
    // 2/5 = 40% success → trips. But consecutive failures only 0 here (last 2 are passes), so no failures>=N first.
    const cfgNoFailGate = baseConfig({ verify: true, maxFailures: 99 });
    const r = evaluateStoppingConditions(manifestOf([]), history, cfgNoFailGate, cfg.startedAt);
    expect(r).toEqual({ shouldStop: true, reason: 'quality-decay', isGuardrail: true });
  });

  it('quality-decay does NOT trigger without --verify', () => {
    const cfg = baseConfig({ verify: false, maxFailures: 99 });
    const history: IterationRecord[] = [
      rec({ n: 1, verify_outcome: 'compile-failed' }),
      rec({ n: 2, verify_outcome: 'compile-failed' }),
      rec({ n: 3, verify_outcome: 'compile-failed' }),
      rec({ n: 4, verify_outcome: 'compile-failed' }),
      rec({ n: 5, verify_outcome: 'compile-failed' }),
    ];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    // verify off → quality-decay shouldn't fire; failures cap is 99 so no guardrail.
    expect(r.reason).not.toBe('quality-decay');
  });

  it('guardrails are evaluated before --until goals', () => {
    const cfg = baseConfig({
      iterationsMax: 1,
      until: [{ kind: 'p0-gaps==0' }],
    });
    // No P0 gaps → goal would fire. But iterationsMax already met.
    const history = [rec()];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r.reason).toBe('iterations>=N');
    expect(r.isGuardrail).toBe(true);
  });
});

describe('evaluateStoppingConditions — --until goals', () => {
  it('p0-gaps==0 stops when no P0 GAP/REGRESSION units remain', () => {
    const cfg = baseConfig({ until: [{ kind: 'p0-gaps==0' }] });
    const m = manifestOf([
      makeUnit({ priority: 'P0', status: 'COVERED' }),
      makeUnit({ priority: 'P1', status: 'GAP' }),
    ]);
    const r = evaluateStoppingConditions(m, [], cfg, cfg.startedAt);
    expect(r).toEqual({ shouldStop: true, reason: 'p0-gaps==0', isGuardrail: false });
  });

  it('p0-gaps==0 does not stop while a P0 GAP exists', () => {
    const cfg = baseConfig({ until: [{ kind: 'p0-gaps==0' }] });
    const m = manifestOf([makeUnit({ priority: 'P0', status: 'GAP' })]);
    expect(evaluateStoppingConditions(m, [], cfg, cfg.startedAt).shouldStop).toBe(false);
  });

  it('p0-gaps==0 treats P0 REGRESSION as a P0 gap', () => {
    const cfg = baseConfig({ until: [{ kind: 'p0-gaps==0' }] });
    const m = manifestOf([makeUnit({ priority: 'P0', status: 'REGRESSION' })]);
    expect(evaluateStoppingConditions(m, [], cfg, cfg.startedAt).shouldStop).toBe(false);
  });

  it('regressions==0 stops when no REGRESSION units remain', () => {
    const cfg = baseConfig({ until: [{ kind: 'regressions==0' }] });
    const m = manifestOf([makeUnit({ status: 'COVERED' }), makeUnit({ status: 'GAP' })]);
    const r = evaluateStoppingConditions(m, [], cfg, cfg.startedAt);
    expect(r.reason).toBe('regressions==0');
  });

  it('coverage>=N% stops at threshold', () => {
    const cfg = baseConfig({ until: [{ kind: 'coverage>=N%', threshold: 50 }] });
    const m = manifestOf([
      makeUnit({ id: 'a', status: 'COVERED' }),
      makeUnit({ id: 'b', status: 'COVERED' }),
      makeUnit({ id: 'c', status: 'GAP' }),
      makeUnit({ id: 'd', status: 'GAP' }),
    ]);
    const r = evaluateStoppingConditions(m, [], cfg, cfg.startedAt);
    expect(r.reason).toBe('coverage>=N%');
  });

  it('coverage ignores IGNORED units in the denominator', () => {
    const cfg = baseConfig({ until: [{ kind: 'coverage>=N%', threshold: 100 }] });
    const m = manifestOf([
      makeUnit({ id: 'a', status: 'COVERED' }),
      makeUnit({ id: 'b', status: 'IGNORED', notes: 'covered by E2E' }),
    ]);
    expect(evaluateStoppingConditions(m, [], cfg, cfg.startedAt).reason).toBe('coverage>=N%');
  });

  it('delta-stalled fires on 3 consecutive zero-net iterations', () => {
    const cfg = baseConfig({ until: [{ kind: 'delta-stalled' }] });
    const history = [
      rec({ n: 1, delta: { covered: 0, partial: 0 } }),
      rec({ n: 2, delta: { covered: 0, partial: 0 } }),
      rec({ n: 3, delta: { covered: 0, partial: 0 } }),
    ];
    const r = evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt);
    expect(r.reason).toBe('delta-stalled');
  });

  it('delta-stalled does not fire when the third iteration closed something', () => {
    const cfg = baseConfig({ until: [{ kind: 'delta-stalled' }] });
    const history = [
      rec({ n: 1, delta: { covered: 0, partial: 0 } }),
      rec({ n: 2, delta: { covered: 0, partial: 0 } }),
      rec({ n: 3, delta: { covered: 1, partial: 0 } }),
    ];
    expect(
      evaluateStoppingConditions(manifestOf([]), history, cfg, cfg.startedAt).shouldStop,
    ).toBe(false);
  });

  it('OR-semantics: any matching --until condition stops the loop', () => {
    // coverage is 50% (1 of 2), so coverage>=99% does NOT match.
    // No P0 gaps, so p0-gaps==0 DOES match.
    const cfg = baseConfig({
      until: [
        { kind: 'coverage>=N%', threshold: 99 },
        { kind: 'p0-gaps==0' },
      ],
    });
    const m = manifestOf([
      makeUnit({ id: 'a', priority: 'P1', status: 'COVERED' }),
      makeUnit({ id: 'b', priority: 'P1', status: 'GAP' }),
    ]);
    const r = evaluateStoppingConditions(m, [], cfg, cfg.startedAt);
    expect(r.reason).toBe('p0-gaps==0');
  });

  it('returns shouldStop=false when no condition fires', () => {
    const cfg = baseConfig({ until: [{ kind: 'p0-gaps==0' }] });
    const m = manifestOf([makeUnit({ priority: 'P0', status: 'GAP' })]);
    const r = evaluateStoppingConditions(m, [], cfg, cfg.startedAt);
    expect(r.shouldStop).toBe(false);
    expect(r.reason).toBeUndefined();
  });
});
