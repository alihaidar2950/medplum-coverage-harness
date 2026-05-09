import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureReportsDir } from '../util/paths.js';
import type { IterationRecord } from './stopping-conditions.js';

export interface LoopLogConfig {
  iterations_max: number;
  until: string[];
  strategy: string;
  budget_minutes: number;
  max_failures: number;
  verify: boolean;
}

export interface LoopLog {
  started_at: string;
  config: LoopLogConfig;
  iterations: IterationRecord[];
  stopped_at?: string;
  stopped_because?: string;
  stopped_by_guardrail?: boolean;
}

export class IterationLogger {
  private log: LoopLog;
  private readonly filePath: string;

  constructor(config: LoopLogConfig, startedAtIso: string, filePath?: string) {
    this.log = {
      started_at: startedAtIso,
      config,
      iterations: [],
    };
    this.filePath = filePath ?? path.join(ensureReportsDir(), 'iteration-log.json');
  }

  append(rec: IterationRecord): void {
    this.log.iterations.push(rec);
    this.flush();
  }

  finish(stoppedBecause: string, isGuardrail: boolean, stoppedAtIso: string): void {
    this.log.stopped_at = stoppedAtIso;
    this.log.stopped_because = stoppedBecause;
    this.log.stopped_by_guardrail = isGuardrail;
    this.flush();
  }

  getRecords(): IterationRecord[] {
    return this.log.iterations;
  }

  getPath(): string {
    return this.filePath;
  }

  private flush(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.log, null, 2), 'utf8');
  }
}
