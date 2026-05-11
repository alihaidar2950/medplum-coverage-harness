import { Command, Errors, Flags } from '@oclif/core';
import { logger } from '../util/logger.js';
import { runLoop } from '../loop/index.js';
import { scanWithRegressions } from '../score/index.js';
import { validatePromptReferences } from '../schema/refs.js';

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

    try {
      // Pre-flight: validate prompt references once, up front. Without this,
      // every iteration would silently splice "// TODO: snippet missing"
      // into the agent's prompt — the loop wouldn't fail loudly, it would
      // just produce useless tests until a guardrail fired.
      const { manifest } = await scanWithRegressions();
      const refs = validatePromptReferences(manifest);
      if (!refs.ok) {
        for (const e of refs.errors) logger.error(e);
        throw new Error(`prompt reference validation failed (${refs.errors.length} error(s))`);
      }

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
      if (err instanceof Errors.ExitError) throw err;
      logger.error('loop failed:', err instanceof Error ? err.message : String(err));
      this.exit(3);
    }
  }
}
