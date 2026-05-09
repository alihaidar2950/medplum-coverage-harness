import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

export const HarnessConfigSchema = z.object({
  target: z.string(),
  scope: z.array(z.string()).default(['packages/app/src']),
});
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

const HARNESS_ROOT = process.cwd();

export function harnessRoot(): string {
  return HARNESS_ROOT;
}

export function configPath(): string {
  return path.join(HARNESS_ROOT, 'harness.config.json');
}

export function manifestPath(): string {
  return path.join(HARNESS_ROOT, 'coverage.manifest.yaml');
}

export function previousManifestPath(): string {
  return path.join(HARNESS_ROOT, 'coverage.manifest.previous.yaml');
}

export function reportsDir(): string {
  return path.join(HARNESS_ROOT, 'reports');
}

export function ensureReportsDir(): string {
  const dir = reportsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadConfig(): HarnessConfig {
  const p = configPath();
  if (!fs.existsSync(p)) {
    throw new Error(`harness.config.json not found at ${p}; run \`harness init --target <path>\``);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return HarnessConfigSchema.parse(raw);
}

export function resolveTargetPath(config: HarnessConfig): string {
  return path.isAbsolute(config.target)
    ? config.target
    : path.resolve(HARNESS_ROOT, config.target);
}

export function isoTimestampForFilename(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}
