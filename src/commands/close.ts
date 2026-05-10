import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../util/logger.js';
import {
  ensureReportsDir,
  isoTimestampForFilename,
  manifestPath,
} from '../util/paths.js';
import { writeManifest } from '../util/yaml.js';
import { scanWithRegressions } from '../score/index.js';
import { closeOne } from '../close/index.js';
import type { Strategy } from '../close/gap-picker.js';
import { renderCloseReport } from '../report/close-report.js';
import { validatePromptReferences } from '../schema/refs.js';

const VALID_STRATEGIES: Strategy[] = [
  'highest-priority',
  'regression-first',
  'fewest-deps',
  'random',
];

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
      options: VALID_STRATEGIES,
      default: 'highest-priority',
    }),
    verify: Flags.boolean({
      description: 'Run Jest on the generated test in the target repo',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Close);
    const generatedAt = new Date().toISOString();

    try {
      // Always scan first so we close against the freshest state — and tag
      // REGRESSION units against the on-disk manifest so `regression-first`
      // and any `regressions==0` callers see meaningful state.
      const { manifest: before } = await scanWithRegressions({ generatedAt });

      // Fail fast if prompt refs are dangling — closing a gap with bad refs
      // sends placeholder text to the agent and produces a worthless test.
      const refs = validatePromptReferences(before);
      if (!refs.ok) {
        for (const e of refs.errors) logger.error(e);
        throw new Error(`prompt reference validation failed (${refs.errors.length} error(s))`);
      }

      const result = await closeOne(before, {
        strategy: flags.strategy as Strategy,
        verify: flags.verify,
        gapId: flags.gap,
      });

      // Persist the post-close (re-scored) manifest.
      writeManifest(manifestPath(), result.after);

      const reportsDir = ensureReportsDir();
      const reportPath = path.join(
        reportsDir,
        `close-${isoTimestampForFilename(new Date(generatedAt))}.md`,
      );
      fs.writeFileSync(reportPath, renderCloseReport(result, generatedAt), 'utf8');

      logger.info(
        `close: gap=${result.outcome.gapPicked} agent=${result.outcome.agentOutcome}` +
          (result.outcome.verifyOutcome ? ` verify=${result.outcome.verifyOutcome}` : '') +
          ` delta=covered${signed(result.outcome.delta.covered)}/partial${signed(result.outcome.delta.partial)}`,
      );
      logger.info(`report: ${reportPath}`);

      // Exit codes per the design contract:
      //   0 success — agent ran AND the targeted unit is now COVERED in `after`
      //   1 agent failed — no file produced or the agent process errored
      //   2 produced test did not match the gap — agent wrote a file, re-scan
      //                                          did not promote the unit to COVERED
      //   3 internal error (covered by the catch below)
      //
      // Exit 2 is the load-bearing distinction between "we wrote a file" and
      // "we closed the gap." Without it, --verify catches compile failures
      // but a compiling-but-unmatched test silently exits 0.
      if (result.outcome.agentOutcome === 'failure') {
        if (result.reason) logger.warn(result.reason);
        this.exit(1);
      }
      if (!result.outcome.gapClosed) {
        logger.warn(
          `agent produced ${result.generatedTestPath ?? '<file>'} but ${result.outcome.gapPicked} is not COVERED post-scan; matcher may not recognize it`,
        );
        this.exit(2);
      }
      this.exit(0);
    } catch (err) {
      logger.error('close failed:', err instanceof Error ? err.message : String(err));
      this.exit(3);
    }
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
