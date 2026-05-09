export interface BudgetSnapshot {
  iterations: number;
  iterationsMax: number;
  elapsedMs: number;
  budgetMs: number;
  consecutiveFailures: number;
  maxFailures: number;
}

export class BudgetTracker {
  private readonly startedAt: number;
  private iterations = 0;
  private consecutiveFailures = 0;

  constructor(
    public readonly iterationsMax: number,
    public readonly budgetMinutes: number,
    public readonly maxFailures: number,
    startedAt: number = Date.now(),
  ) {
    this.startedAt = startedAt;
  }

  get startedAtMs(): number {
    return this.startedAt;
  }

  recordIteration(): void {
    this.iterations += 1;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  elapsedMs(now: number = Date.now()): number {
    return now - this.startedAt;
  }

  snapshot(now: number = Date.now()): BudgetSnapshot {
    return {
      iterations: this.iterations,
      iterationsMax: this.iterationsMax,
      elapsedMs: this.elapsedMs(now),
      budgetMs: this.budgetMinutes * 60_000,
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: this.maxFailures,
    };
  }

  getIterations(): number {
    return this.iterations;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}
