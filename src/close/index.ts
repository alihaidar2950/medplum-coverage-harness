import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../util/logger.js';
import { loadConfig, resolveTargetPath } from '../util/paths.js';
import { scoreUnits } from '../score/index.js';
import { discover } from '../discover/index.js';
import type { Manifest, Unit } from '../schema/manifest.js';
import { buildClosePrompt, type BuiltPrompt } from './prompt-builder.js';
import { pickGap, pickGapById, type Strategy } from './gap-picker.js';
import { invokeAgent } from './agent-invoker.js';
import { runVerify, type VerifyOutcome, type VerifyResult } from './verify.js';
import { computeDelta } from './delta-reporter.js';

export interface CloseOutcome {
  gapPicked: string;
  gapPriority: string;
  agentOutcome: 'success' | 'failure';
  verifyOutcome?: VerifyOutcome;
  delta: { covered: number; partial: number };
}

export interface CloseResult {
  outcome: CloseOutcome;
  /** The Unit picked for closing. */
  unit?: Unit;
  /** Manifest before this iteration. */
  before: Manifest;
  /** Manifest after re-scoring against the target repo. */
  after: Manifest;
  /** Prompt rendered + the path we expected the agent to write. */
  prompt?: BuiltPrompt;
  /** File contents the agent produced (if found). */
  generatedTest?: string;
  /** Path to the generated test, repo-relative under target. */
  generatedTestPath?: string;
  verify?: VerifyResult;
  /** Diagnostic message when the agent failed to produce the expected file. */
  reason?: string;
}

export interface CloseOptions {
  strategy: Strategy;
  verify: boolean;
  /** Force a specific gap. Overrides strategy. */
  gapId?: string;
  /** Override target repo (default reads from harness.config.json). */
  targetRepo?: string;
  /** Optional agent timeout. */
  agentTimeoutMs?: number;
  /** Optional verify timeout. */
  verifyTimeoutMs?: number;
}

/**
 * One iteration: pick → prompt → agent → (verify) → re-score → delta.
 * Returns a CloseResult with all the artifacts the report renderer needs.
 */
export async function closeOne(
  before: Manifest,
  options: CloseOptions,
): Promise<CloseResult> {
  const targetRepo = options.targetRepo ?? resolveTargetPath(loadConfig());

  const unit = options.gapId
    ? pickGapById(before, options.gapId)
    : pickGap(before, options.strategy);

  if (!unit) {
    return {
      outcome: {
        gapPicked: options.gapId ?? '<none>',
        gapPriority: 'P?',
        agentOutcome: 'failure',
        delta: { covered: 0, partial: 0 },
      },
      before,
      after: before,
      reason: options.gapId
        ? `gap id ${options.gapId} not found in manifest`
        : 'no GAP/REGRESSION units to pick',
    };
  }

  if (unit.status === 'COVERED' || unit.status === 'PARTIAL' || unit.status === 'IGNORED') {
    return {
      outcome: {
        gapPicked: unit.id,
        gapPriority: unit.priority,
        agentOutcome: 'failure',
        delta: { covered: 0, partial: 0 },
      },
      unit,
      before,
      after: before,
      reason: `unit ${unit.id} is already ${unit.status}; nothing to close`,
    };
  }

  const surface = before.surfaces.find((s) => s.id === unit.surface);
  const precondition = before.preconditions.find((p) => p.id === unit.precondition);
  const behavior = before.behaviors.find((b) => b.id === unit.behavior);
  if (!surface || !precondition || !behavior) {
    return {
      outcome: {
        gapPicked: unit.id,
        gapPriority: unit.priority,
        agentOutcome: 'failure',
        delta: { covered: 0, partial: 0 },
      },
      unit,
      before,
      after: before,
      reason: 'manifest cross-reference broken (surface/precondition/behavior missing)',
    };
  }

  const prompt = buildClosePrompt({ unit, surface, precondition, behavior });
  const expectedAbsPath = path.join(targetRepo, prompt.expectedTestFile);

  // Ensure the expected directory exists so the agent's Write tool can use it.
  fs.mkdirSync(path.dirname(expectedAbsPath), { recursive: true });

  // If a stale file is sitting at the target path, remove it so we can verify
  // that *this* invocation produced something.
  if (fs.existsSync(expectedAbsPath)) {
    fs.rmSync(expectedAbsPath);
  }

  logger.info(`close: gap=${unit.id} → ${prompt.expectedTestFile}`);
  const agent = await invokeAgent({
    prompt: prompt.text,
    cwd: targetRepo,
    timeoutMs: options.agentTimeoutMs,
    allowedTools: ['Write'],
  });

  let agentOutcome: 'success' | 'failure' = 'failure';
  let generatedTest: string | undefined;
  let reason: string | undefined;

  if (!agent.ok) {
    reason = `agent process exited with code ${agent.exitCode}`;
  } else if (!fs.existsSync(expectedAbsPath)) {
    reason = `agent did not write the expected file: ${prompt.expectedTestFile}`;
  } else {
    generatedTest = fs.readFileSync(expectedAbsPath, 'utf8');
    agentOutcome = 'success';
  }

  // Optional verify (only meaningful when the agent produced a file).
  let verify: VerifyResult | undefined;
  let verifyOutcome: VerifyOutcome | undefined;
  if (options.verify && agentOutcome === 'success') {
    verify = await runVerify({
      testFile: prompt.expectedTestFile,
      targetRepo,
      timeoutMs: options.verifyTimeoutMs,
    });
    verifyOutcome = verify.outcome;
  } else if (options.verify) {
    verifyOutcome = 'not-run';
  }

  // Re-scan to compute delta. Re-uses discover + scoreUnits; intentionally
  // skips the Manifest cross-write so the caller controls persistence.
  const rescanned = discover({ targetRepo, generatedAt: new Date().toISOString() });
  const after = scoreUnits(rescanned, targetRepo);

  const delta = computeDelta(before, after);

  return {
    outcome: {
      gapPicked: unit.id,
      gapPriority: unit.priority,
      agentOutcome,
      verifyOutcome,
      delta,
    },
    unit,
    before,
    after,
    prompt,
    generatedTest,
    generatedTestPath: agentOutcome === 'success' ? prompt.expectedTestFile : undefined,
    verify,
    reason,
  };
}

/**
 * LoopDeps adapter: the loop only needs the CloseOutcome shape. This is the
 * default `close` injected when running `harness loop`.
 */
export async function closeForLoop(
  manifest: Manifest,
  strategy: string,
  verify: boolean,
): Promise<CloseOutcome> {
  const result = await closeOne(manifest, {
    strategy: strategy as Strategy,
    verify,
  });
  return result.outcome;
}
