import { Command, Flags } from '@oclif/core';
import { logger } from '../util/logger.js';
import { runLoop } from '../loop/index.js';

export default class Loop extends Command {
  static override description =
    'Run the autonomous loop: scan → check stops → pick → close → verify → log, until a goal or guardrail fires.';

  static override examples = [
    '<%= config.bin %> loop --until p0-gaps==0 --verify',
    '<%= config.bin %> loop --iterations 5 --strategy regression-first',
  ];

  static override flags = {
    iterations: Flags.integer({ default: 10, description: 'Hard iteration cap (always enforced)' }),
    until: Flags.string({
      multiple: true,
      default: ['p0-gaps==0', 'delta-stalled'],
      description: 'Stopping conditions, OR’d. e.g. p0-gaps==0, regressions==0, coverage>=50%, delta-stalled',
    }),
    strategy: Flags.string({
      default: 'highest-priority',
      options: ['highest-priority', 'regression-first', 'fewest-deps', 'random'],
      description: 'Gap picker strategy',
    }),
    budget: Flags.integer({ default: 30, description: 'Wall-clock budget in minutes (always enforced)' }),
    'max-failures': Flags.integer({ default: 3, description: 'Consecutive failure cap (always enforced)' }),
    verify: Flags.boolean({ default: false, description: 'Run Jest each iteration; required for quality-decay detection' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Loop);

    // The loop controller is wired up; close()/scan() it depends on are
    // currently stubbed. The stopping-conditions module IS fully implemented,
    // so the safety logic is exercisable via tests today.
    try {
      const result = await runLoop({
        iterations: flags.iterations,
        until: flags.until,
        strategy: flags.strategy,
        budgetMinutes: flags.budget,
        maxFailures: flags['max-failures'],
        verify: flags.verify,
      });
      logger.info(
        `loop finished after ${result.iterationsRun} iteration(s); reason=${result.stoppedBecause}`,
      );
      logger.info(`report: ${result.reportPath}`);
      logger.info(`log:    ${result.logPath}`);
      this.exit(result.isGuardrail ? 4 : 0);
    } catch (err) {
      logger.error('loop failed:', err instanceof Error ? err.message : String(err));
      this.exit(3);
    }
  }
}
