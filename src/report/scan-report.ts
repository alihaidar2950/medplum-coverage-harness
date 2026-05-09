import type { Manifest, Priority, Unit, UnitStatus } from '../schema/manifest.js';
import type { UnitDiff } from '../score/regression-detector.js';

export interface ScanReportInputs {
  manifest: Manifest;
  previous?: Manifest;
  diff: UnitDiff;
  generatedAt: string;
}

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2'];
const STATUSES: UnitStatus[] = ['COVERED', 'PARTIAL', 'GAP', 'REGRESSION', 'IGNORED'];

export function renderScanReport(inputs: ScanReportInputs): string {
  const { manifest, previous, diff, generatedAt } = inputs;
  const units = manifest.units;
  const gapsByPriority = countGapsByPriority(units);

  const lines: string[] = [];
  lines.push(`# Scan Report`);
  lines.push('');
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Target:** ${manifest.target.repo}`);
  lines.push(`- **Surfaces:** ${manifest.surfaces.length}`);
  lines.push(`- **Preconditions:** ${manifest.preconditions.length}`);
  lines.push(`- **Behaviors:** ${manifest.behaviors.length}`);
  lines.push(`- **Units:** ${units.length}`);
  lines.push('');

  lines.push(`## Headlines`);
  lines.push('');
  for (const p of PRIORITIES) {
    lines.push(`- **${p} gaps:** ${gapsByPriority[p]}`);
  }
  lines.push(`- **Regressions:** ${diff.regressionIds.length}`);
  lines.push(`- **New units:** ${diff.newIds.length}`);
  lines.push(`- **Retired units:** ${diff.retiredIds.length}`);
  if (!previous) {
    lines.push('');
    lines.push(`> First scan — no previous manifest to diff against.`);
  }
  lines.push('');

  lines.push(`## Status × Priority`);
  lines.push('');
  lines.push(`| Priority | ${STATUSES.join(' | ')} | Total |`);
  lines.push(`| --- | ${STATUSES.map(() => '---').join(' | ')} | --- |`);
  for (const p of PRIORITIES) {
    const counts = STATUSES.map(
      (s) => units.filter((u) => u.priority === p && u.status === s).length,
    );
    const total = counts.reduce((a, b) => a + b, 0);
    lines.push(`| ${p} | ${counts.join(' | ')} | ${total} |`);
  }
  lines.push('');

  if (diff.regressionIds.length > 0) {
    lines.push(`## Regressions (sample)`);
    lines.push('');
    for (const id of diff.regressionIds.slice(0, 20)) lines.push(`- \`${id}\``);
    if (diff.regressionIds.length > 20) {
      lines.push(`- … +${diff.regressionIds.length - 20} more`);
    }
    lines.push('');
  }

  const p0Sample = units
    .filter((u) => u.priority === 'P0' && (u.status === 'GAP' || u.status === 'REGRESSION'))
    .slice(0, 10);
  if (p0Sample.length > 0) {
    lines.push(`## Sample P0 gaps`);
    lines.push('');
    const surfaceById = new Map(manifest.surfaces.map((s) => [s.id, s]));
    for (const u of p0Sample) {
      const s = surfaceById.get(u.surface);
      const where = s ? `${s.route} (${s.component})` : u.surface;
      lines.push(`- \`${u.id}\` → ${where}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function countGapsByPriority(units: Unit[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { P0: 0, P1: 0, P2: 0 };
  for (const u of units) {
    if (u.status === 'GAP' || u.status === 'REGRESSION') counts[u.priority] += 1;
  }
  return counts;
}
