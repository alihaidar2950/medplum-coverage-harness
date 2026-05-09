import type { Manifest } from '../schema/manifest.js';
import type { VerifyOutcome } from './verify.js';
import { logger } from '../util/logger.js';

export interface CloseOutcome {
  gapPicked: string;
  gapPriority: string;
  agentOutcome: 'success' | 'failure';
  verifyOutcome?: VerifyOutcome;
  delta: { covered: number; partial: number };
}

/**
 * One iteration: pick → prompt → agent → (verify) → re-score → report.
 * Currently a stub: the loop controller calls this and consumes the
 * CloseOutcome shape. Real wiring happens in subsequent passes.
 */
export async function closeOne(
  _manifest: Manifest,
  _strategy: string,
  _verify: boolean,
): Promise<CloseOutcome> {
  logger.warn('TODO: implement close orchestration (pick → prompt → agent → verify → re-score)');
  throw new Error('TODO: implement close orchestration');
}
