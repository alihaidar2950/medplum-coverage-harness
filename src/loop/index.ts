import { logger } from '../util/logger.js';
import { closeOne, type CloseOutcome } from '../close/index.js';
import { scan } from '../score/index.js';
import { BudgetTracker } from './budget-tracker.js';
import { IterationLogger, type LoopLogConfig } from './iteration-logger.js';
import {
  evaluateStoppingConditions,
  parseUntil,
  type IterationRecord,
  type LoopConfig,
  type StopReason,
  type UntilCondition,
} from './stopping-conditions.js';
import type { Manifest } from '../schema/manifest.js';

export interface LoopOptions {
  iterations: number;
  until: string[];
  strategy: string;
  budgetMinutes: number;
  maxFailures: number;
  verify: boolean;
}

export interface LoopResult {
  stoppedBecause: StopReason;
  isGuardrail: boolean;
  iterationsRun: number;
  logPath: string;
}

/**
 * Loop dependencies. Real implementation passes the production scan/close;
 * tests can inject deterministic stubs.
 */
export interface LoopDeps {
  scan: () => Promise<Manifest>;
  close: (manifest: Manifest, strategy: string, verify: boolean) => Promise<CloseOutcome>;
  now?: () => number;
}

const defaultDeps: LoopDeps = {
  scan,
  close: closeOne,
};

export async function runLoop(
  options: LoopOptions,
  deps: LoopDeps = defaultDeps,
): Promise<LoopResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const startedAtIso = new Date(startedAt).toISOString();

  const until: UntilCondition[] = options.until.map(parseUntil);

  const loopConfig: LoopConfig = {
    iterationsMax: options.iterations,
    budgetMinutes: options.budgetMinutes,
    maxFailures: options.maxFailures,
    until,
    verify: options.verify,
    startedAt,
  };

  const logConfig: LoopLogConfig = {
    iterations_max: options.iterations,
    until: options.until,
    strategy: options.strategy,
    budget_minutes: options.budgetMinutes,
    max_failures: options.maxFailures,
    verify: options.verify,
  };

  const iterLog = new IterationLogger(logConfig, startedAtIso);
  const budget = new BudgetTracker(
    options.iterations,
    options.budgetMinutes,
    options.maxFailures,
    startedAt,
  );

  const history: IterationRecord[] = [];

  // Loop body: scan → check stops → close → log.
  while (true) {
    const manifest = await deps.scan();

    const check = evaluateStoppingConditions(manifest, history, loopConfig, now());
    if (check.shouldStop) {
      const reason = check.reason ?? 'iterations>=N';
      iterLog.finish(reason, check.isGuardrail, new Date(now()).toISOString());
      logger.info(
        `loop stopped: ${reason} (${check.isGuardrail ? 'guardrail' : 'goal'})`,
      );
      return {
        stoppedBecause: reason,
        isGuardrail: check.isGuardrail,
        iterationsRun: history.length,
        logPath: iterLog.getPath(),
      };
    }

    const iterStartedAtMs = now();
    const iterStartedAtIso = new Date(iterStartedAtMs).toISOString();
    const outcome = await deps.close(manifest, options.strategy, options.verify);
    const elapsedMs = now() - iterStartedAtMs;

    if (outcome.agentOutcome === 'failure') {
      budget.recordFailure();
    } else if (outcome.verifyOutcome === 'compile-failed') {
      budget.recordFailure();
    } else {
      budget.recordSuccess();
    }
    budget.recordIteration();

    const record: IterationRecord = {
      n: history.length + 1,
      started_at: iterStartedAtIso,
      gap_picked: outcome.gapPicked,
      gap_priority: outcome.gapPriority,
      agent_duration_ms: elapsedMs,
      agent_outcome: outcome.agentOutcome,
      verify_outcome: outcome.verifyOutcome,
      delta: outcome.delta,
    };
    history.push(record);
    iterLog.append(record);

    logger.info(
      `iteration ${record.n}: ${record.gap_picked} → ${record.agent_outcome}` +
        (record.verify_outcome ? ` / ${record.verify_outcome}` : ''),
    );
  }
}
