import type { ParsedTest } from './test-parser.js';

export type PreconditionId =
  | 'pre.unauthed'
  | 'pre.practitioner.empty'
  | 'pre.practitioner.with-patient'
  | 'pre.admin.empty'
  | 'pre.admin.with-project';

export interface PreconditionGuess {
  precondition: PreconditionId | undefined;
  /** True when classifier had a confident signal; false when it fell back to a default. */
  confident: boolean;
}

/**
 * Map a parsed test's MockClient setup to a precondition id. Heuristic:
 *   profile: null                    → pre.unauthed
 *   identifier matching /admin/i     → pre.admin.*
 *   any other identifier             → pre.practitioner.*
 *   bare new MockClient()            → pre.practitioner.empty (default), low confidence
 *   setActiveLoginOverride           → admin (force)
 *
 * Resource creation refines admin/practitioner into the *.with-X variant when
 * a known resource type was created.
 */
export function classifyMockSetup(parsed: ParsedTest): PreconditionGuess {
  const profiles = parsed.mockClientProfiles;
  if (profiles.length === 0) return { precondition: undefined, confident: false };

  // If any setup is unauthed, we treat the file as exercising an unauthed flow.
  if (profiles.some((p) => p.kind === 'null')) {
    return { precondition: 'pre.unauthed', confident: true };
  }

  let role: 'admin' | 'practitioner' = 'practitioner';
  let confident = false;

  for (const p of profiles) {
    if (p.kind === 'identifier' && p.identifier) {
      confident = true;
      if (/admin/i.test(p.identifier)) role = 'admin';
    }
  }

  if (parsed.hasSetActiveLoginOverride) {
    role = 'admin';
    confident = true;
  }

  // Look for resource refinements
  const created = parsed.createdResourceTypes;
  if (role === 'practitioner') {
    if (created.includes('Patient')) {
      return { precondition: 'pre.practitioner.with-patient', confident: true };
    }
    return { precondition: 'pre.practitioner.empty', confident };
  }
  if (created.includes('Project')) {
    return { precondition: 'pre.admin.with-project', confident: true };
  }
  return { precondition: 'pre.admin.empty', confident };
}
