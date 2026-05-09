import { Command, Flags } from '@oclif/core';
import { logger } from '../util/logger.js';

export default class Close extends Command {
  static override description =
    'Run one iteration: pick a gap, prompt the agent, optionally verify, re-score, write a delta report.';

  static override examples = [
    '<%= config.bin %> close --gap unit.signin.unauthed.renders --verify',
    '<%= config.bin %> close --strategy fewest-deps',
  ];

  static override flags = {
    gap: Flags.string({ description: 'Specific unit id to close' }),
    strategy: Flags.string({
      description: 'Gap picker strategy if --gap is not provided',
      options: ['highest-priority', 'regression-first', 'fewest-deps', 'random'],
      default: 'highest-priority',
    }),
    verify: Flags.boolean({
      description: 'Run Jest on the generated test in the target repo',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Close);
    logger.warn('not yet implemented: close');
    logger.info(
      `expected behavior (gap=${flags.gap ?? '<picked>'}, strategy=${flags.strategy}, verify=${flags.verify}):\n` +
        '  1. pick gap (--gap > strategy)\n' +
        '  2. render close-gap.md prompt with surface/precondition/behavior\n' +
        '  3. spawn `claude --print` to write test file at packages/app/src/<surface-path>/<surface-name>.<beh>.test.tsx\n' +
        '  4. if --verify: spawn `npx jest <file>` in target repo (failure does NOT block COVERED)\n' +
        '  5. re-score, write reports/close-<ISO>.md (Before / Generated Test / After / Verify)\n' +
        '  exit codes: 0 success, 1 agent failed, 2 produced test did not match gap, 3 internal error',
    );
    this.exit(3);
  }
}
