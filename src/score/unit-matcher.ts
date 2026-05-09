import type { BehaviorId, Manifest, Unit } from '../schema/manifest.js';
import { classifyMockSetup } from './mock-call-extractor.js';
import type { ParsedTest, TestCase } from './test-parser.js';

export interface UnitMatch {
  unitId: string;
  status: 'COVERED' | 'PARTIAL';
  /** Repo-relative test file path that produced this match. */
  source: string;
}

/**
 * Three-signal matcher:
 *   1. Filename → Surface (basename equals surface.component)
 *   2. MockClient setup → Precondition
 *   3. Test name + body keywords → Behavior
 *
 * COVERED  when filename matches AND mock-setup is confident.
 * PARTIAL  when filename matches but mock-setup is unknown / fallback.
 * No match when filename does not correspond to any surface.
 */
export function matchTestToUnits(parsed: ParsedTest, manifest: Manifest): UnitMatch[] {
  // Surfaces this file plausibly covers, by component-name match.
  const surfaces = manifest.surfaces.filter((s) => s.component === parsed.baseName);
  if (surfaces.length === 0) return [];

  const guess = classifyMockSetup(parsed);
  if (!guess.precondition) return [];

  const status: UnitMatch['status'] = guess.confident ? 'COVERED' : 'PARTIAL';

  // Determine behaviors covered. If we recognize specific behaviors from test
  // names/bodies, emit one entry per behavior. Always include beh.renders as
  // a baseline when the file has any test cases.
  const behaviors = new Set<BehaviorId>();
  if (parsed.testCases.length > 0) behaviors.add('beh.renders');
  for (const tc of parsed.testCases) {
    const beh = classifyBehavior(tc);
    if (beh) behaviors.add(beh);
  }

  const unitsBySurface = new Map<string, Unit[]>();
  for (const u of manifest.units) {
    const arr = unitsBySurface.get(u.surface);
    if (arr) arr.push(u);
    else unitsBySurface.set(u.surface, [u]);
  }

  const matches: UnitMatch[] = [];
  for (const surface of surfaces) {
    const units = unitsBySurface.get(surface.id) ?? [];
    for (const unit of units) {
      if (unit.precondition !== guess.precondition) continue;
      if (!behaviors.has(unit.behavior as BehaviorId)) continue;
      matches.push({ unitId: unit.id, status, source: parsed.filePath });
    }
  }
  return matches;
}

/**
 * Map a single test() block to a behavior. Order matters: the first rule
 * that matches wins, so more-specific signals (validation, navigation) come
 * before broader ones (error, renders).
 */
export function classifyBehavior(tc: TestCase): BehaviorId | undefined {
  const haystack = `${tc.name}\n${tc.bodyText}`.toLowerCase();

  if (/\b(validation|invalid|required|missing)\b/.test(haystack)) {
    return 'beh.form-validation-error';
  }
  if (/\b(submit|save|create successfully|sign in|signin|register|signup|password)\b/.test(haystack)) {
    if (/\bsubmit|sign\s?in|register|save|create/i.test(haystack)) {
      return 'beh.form-submit-success';
    }
  }
  if (/\b(redirect|navigate|navigates|goes to|links to)\b/.test(haystack)) {
    return 'beh.navigates';
  }
  if (/\b(empty|no results|nothing to show|no patients)\b/.test(haystack)) {
    return 'beh.empty-state';
  }
  if (/\b(error|failure|reject|fail|throws)\b/.test(haystack)) {
    return 'beh.error-state';
  }
  if (/\b(list|table|rows|displayed|search-control)\b/.test(haystack)) {
    return 'beh.list-displayed';
  }
  if (/\brender/.test(haystack) || /\.test\b/.test(tc.name.toLowerCase())) {
    return 'beh.renders';
  }
  return undefined;
}
