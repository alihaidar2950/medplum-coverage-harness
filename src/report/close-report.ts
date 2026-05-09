import type { CloseResult } from '../close/index.js';

export function renderCloseReport(result: CloseResult, generatedAtIso: string): string {
  const { outcome, unit, before, after, prompt, generatedTest, verify, reason } = result;
  const beforeStatus = unit ? before.units.find((u) => u.id === unit.id)?.status : undefined;
  const afterStatus = unit ? after.units.find((u) => u.id === unit.id)?.status : undefined;

  const lines: string[] = [];
  lines.push(`# Close Report`);
  lines.push('');
  lines.push(`- **Generated:** ${generatedAtIso}`);
  lines.push(`- **Gap:** \`${outcome.gapPicked}\``);
  lines.push(`- **Priority:** ${outcome.gapPriority}`);
  lines.push(`- **Agent outcome:** ${outcome.agentOutcome}`);
  if (outcome.verifyOutcome) lines.push(`- **Verify outcome:** ${outcome.verifyOutcome}`);
  lines.push(`- **Delta:** covered ${signed(outcome.delta.covered)}, partial ${signed(outcome.delta.partial)}`);
  if (reason) lines.push(`- **Reason:** ${reason}`);
  lines.push('');

  if (unit) {
    lines.push(`## Targeted unit`);
    lines.push('');
    lines.push(`- **Surface:** \`${unit.surface}\``);
    lines.push(`- **Precondition:** \`${unit.precondition}\``);
    lines.push(`- **Behavior:** \`${unit.behavior}\``);
    lines.push(`- **Status before:** ${beforeStatus ?? '?'}`);
    lines.push(`- **Status after:** ${afterStatus ?? '?'}`);
    lines.push('');
  }

  if (prompt) {
    lines.push(`## Expected test file`);
    lines.push('');
    lines.push(`\`${prompt.expectedTestFile}\``);
    lines.push('');
  }

  if (generatedTest) {
    lines.push(`## Generated test`);
    lines.push('');
    lines.push('```tsx');
    lines.push(generatedTest.trimEnd());
    lines.push('```');
    lines.push('');
  }

  if (verify) {
    lines.push(`## Verify`);
    lines.push('');
    lines.push(`- **Outcome:** ${verify.outcome}`);
    lines.push(`- **Exit code:** ${verify.exitCode}`);
    lines.push(`- **Duration:** ${verify.durationMs}ms`);
    if (verify.stderr.trim().length > 0) {
      lines.push('');
      lines.push(`<details><summary>stderr</summary>`);
      lines.push('');
      lines.push('```');
      lines.push(verify.stderr.trim().slice(0, 4000));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return `${n}`;
}
