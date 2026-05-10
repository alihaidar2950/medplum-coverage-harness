import * as path from 'node:path';
import type { Precondition } from '../schema/manifest.js';
import { discoverTestFiles, parseTestFile, type ParsedTest } from '../score/test-parser.js';

interface Signature {
  auth: 'none' | 'practitioner' | 'admin';
  resources: { resourceType: string; count: number }[];
}

const SEED_CATALOG: Precondition[] = [
  {
    id: 'pre.unauthed',
    description: 'unauthenticated MockClient — no signed-in user',
    auth: 'none',
    resources: [],
    mock_setup_ref: 'prompts/mock-setups.md#pre.unauthed',
  },
  {
    id: 'pre.practitioner.empty',
    description: 'practitioner signed in, no FHIR resources seeded',
    auth: 'practitioner',
    resources: [],
    mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.empty',
  },
  {
    id: 'pre.practitioner.with-patient',
    description: 'practitioner signed in, 1 Patient seeded',
    auth: 'practitioner',
    resources: [{ resourceType: 'Patient', count: 1 }],
    mock_setup_ref: 'prompts/mock-setups.md#pre.practitioner.with-patient',
  },
  {
    id: 'pre.admin.empty',
    description: 'project admin signed in, no project resources',
    auth: 'admin',
    resources: [],
    mock_setup_ref: 'prompts/mock-setups.md#pre.admin.empty',
  },
  {
    id: 'pre.admin.with-project',
    description: 'project admin signed in, 1 Project seeded',
    auth: 'admin',
    resources: [{ resourceType: 'Project', count: 1 }],
    mock_setup_ref: 'prompts/mock-setups.md#pre.admin.with-project',
  },
];

/**
 * Build the precondition catalog by combining the hand-curated seeds with
 * patterns observed in the target repo's existing tests. New patterns
 * (e.g. "practitioner + 1 Encounter + 1 Observation") are emitted as
 * auto-discovered preconditions with synthesized mock_setup_snippet so they
 * stay usable by the prompt builder without writing back to
 * prompts/mock-setups.md.
 *
 * The "synchronized as the app evolves" criterion in the brief is met here:
 * adding a new MockClient setup pattern in any test file shows up in the
 * next scan as a new entry in the catalog.
 */
export function discoverMockCatalog(targetRepo: string): Precondition[] {
  const seedKeys = new Set(SEED_CATALOG.map((p) => signatureKey(toSignature(p))));
  const observed = new Map<string, { sig: Signature; seenIn: string[] }>();

  for (const file of discoverTestFiles(targetRepo)) {
    let parsed: ParsedTest;
    try {
      parsed = parseTestFile(file);
    } catch {
      continue;
    }
    const sig = extractSignature(parsed);
    if (!sig) continue;
    const key = signatureKey(sig);
    const rel = path.relative(targetRepo, file).split(path.sep).join('/');
    const existing = observed.get(key);
    if (existing) {
      existing.seenIn.push(rel);
    } else {
      observed.set(key, { sig, seenIn: [rel] });
    }
  }

  const result: Precondition[] = [...SEED_CATALOG];
  for (const [key, { sig, seenIn }] of observed) {
    if (seedKeys.has(key)) continue;
    result.push(synthesize(sig, seenIn));
  }
  return result;
}

/**
 * Extract a (auth, resources) signature from a parsed test. Returns
 * undefined when the test gives no confident signal — we do not emit
 * catalog entries from bare `new MockClient()` tests because the auth role
 * is ambiguous and would just collide with pre.practitioner.empty anyway.
 */
export function extractSignature(parsed: ParsedTest): Signature | undefined {
  // Profile: null is a strong signal — unauthed, no resources matter.
  for (const p of parsed.mockClientProfiles) {
    if (p.kind === 'null') return { auth: 'none', resources: [] };
  }

  let auth: 'none' | 'practitioner' | 'admin' = 'practitioner';
  let confident = false;

  for (const p of parsed.mockClientProfiles) {
    if (p.kind === 'identifier' && p.identifier) {
      confident = true;
      if (/admin/i.test(p.identifier)) auth = 'admin';
    }
  }
  if (parsed.hasSetActiveLoginOverride) {
    auth = 'admin';
    confident = true;
  }

  if (!confident) return undefined;

  // Aggregate createResource calls into resourceType counts.
  const counts: Record<string, number> = {};
  for (const rt of parsed.createdResourceTypes) {
    counts[rt] = (counts[rt] ?? 0) + 1;
  }
  const resources = Object.entries(counts)
    .map(([resourceType, count]) => ({ resourceType, count }))
    .sort((a, b) => a.resourceType.localeCompare(b.resourceType));

  return { auth, resources };
}

export function signatureKey(s: Signature): string {
  const r = s.resources.map((x) => `${x.resourceType}:${x.count}`).join(',');
  return `${s.auth}|${r}`;
}

function toSignature(p: Precondition): Signature {
  return { auth: p.auth, resources: p.resources };
}

function autoId(sig: Signature): string {
  if (sig.resources.length === 0) return `pre.${sig.auth}.empty`;
  const parts = sig.resources.map((r) => {
    const lower = r.resourceType.toLowerCase();
    return r.count === 1 ? lower : `${lower}-${r.count}`;
  });
  return `pre.${sig.auth}.with-${parts.join('-')}`;
}

function autoDescription(sig: Signature, seenIn: string[]): string {
  const role = sig.auth === 'none' ? 'unauthenticated' : `${sig.auth} signed in`;
  if (sig.resources.length === 0) {
    return `auto-discovered: ${role}, no resources seeded (seen in ${seenIn.length} test file(s))`;
  }
  const resSummary = sig.resources
    .map((r) => `${r.count} ${r.resourceType}`)
    .join(', ');
  return `auto-discovered: ${role}, ${resSummary} (seen in ${seenIn.length} test file(s))`;
}

function synthesize(sig: Signature, seenIn: string[]): Precondition {
  return {
    id: autoId(sig),
    description: autoDescription(sig, seenIn),
    auth: sig.auth,
    resources: sig.resources,
    mock_setup_ref: 'auto-discovered',
    mock_setup_snippet: autoSnippet(sig),
    auto_discovered: true,
  };
}

function autoSnippet(sig: Signature): string {
  const lines: string[] = [];
  lines.push(
    `// Auto-discovered MockClient setup. Adjust resource fields to match the surface under test.`,
  );
  if (sig.auth === 'none') {
    lines.push(`const medplum = new MockClient({ profile: null });`);
    return lines.join('\n');
  }
  if (sig.auth === 'admin') {
    lines.push(`const medplum = new MockClient();`);
    lines.push(`medplum.setActiveLoginOverride({`);
    lines.push(`  accessToken: 'fake', refreshToken: 'fake',`);
    lines.push(`  profile: { resourceType: 'ProjectMembership', admin: true } as any,`);
    lines.push(`});`);
  } else {
    lines.push(`import { DrAliceSmith } from '@medplum/mock';`);
    lines.push(`const medplum = new MockClient({ profile: DrAliceSmith });`);
  }
  for (const r of sig.resources) {
    for (let i = 0; i < r.count; i++) {
      lines.push(
        `await medplum.createResource({ resourceType: '${r.resourceType}', /* TODO: fields */ });`,
      );
    }
  }
  return lines.join('\n');
}
