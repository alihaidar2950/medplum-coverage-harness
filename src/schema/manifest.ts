import { z } from 'zod';

export const SurfaceSchema = z.object({
  id: z.string().regex(/^surface\..+$/),
  route: z.string(),
  component: z.string(),
  discovered_via: z.string(),
});

export const PreconditionSchema = z.object({
  id: z.string().regex(/^pre\..+$/),
  description: z.string(),
  auth: z.enum(['none', 'practitioner', 'admin']),
  resources: z.array(
    z.object({
      resourceType: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  mock_setup_ref: z.string(),
  /**
   * Optional inline snippet used by auto-discovered preconditions that don't
   * have a hand-written section in prompts/mock-setups.md. When present, the
   * ref is decorative and the prompt builder uses this verbatim. The ref
   * validator skips the file-anchor check for entries with an inline snippet.
   */
  mock_setup_snippet: z.string().optional(),
  /** True for catalog entries synthesized from observed MockClient setups. */
  auto_discovered: z.boolean().optional(),
});

export const BehaviorIdSchema = z.enum([
  'beh.renders',
  'beh.list-displayed',
  'beh.form-submit-success',
  'beh.form-validation-error',
  'beh.navigates',
  'beh.empty-state',
  'beh.error-state',
  // Healthcare-specific behaviors. These are deliberately part of the core
  // vocabulary (not an extension axis) because they capture clinical risk that
  // generic UI verbs cannot express.
  'beh.phi-masked',
  'beh.audit-event-emitted',
  'beh.consent-honored',
]);

export const BehaviorSchema = z.object({
  id: BehaviorIdSchema,
  description: z.string(),
  assertion_ref: z.string(),
});

export const UnitStatusSchema = z.enum([
  'COVERED',
  'PARTIAL',
  'GAP',
  'REGRESSION',
  'IGNORED',
]);

export const PrioritySchema = z.enum(['P0', 'P1', 'P2']);

export const UnitSchema = z
  .object({
    id: z.string(),
    surface: z.string(),
    precondition: z.string(),
    behavior: z.string(),
    priority: PrioritySchema,
    status: UnitStatusSchema,
    covered_by: z.array(z.string()),
    notes: z.string().optional(),
  })
  .refine(
    (u) => u.status !== 'IGNORED' || (u.notes !== undefined && u.notes.length > 0),
    { message: 'IGNORED units must have notes with a reason' },
  );

export const ManifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().datetime(),
  target: z.object({
    repo: z.string(),
    scope: z.array(z.string()),
    commit: z.string().optional(),
  }),
  surfaces: z.array(SurfaceSchema),
  preconditions: z.array(PreconditionSchema),
  behaviors: z.array(BehaviorSchema),
  units: z.array(UnitSchema),
});

export type Surface = z.infer<typeof SurfaceSchema>;
export type Precondition = z.infer<typeof PreconditionSchema>;
export type Behavior = z.infer<typeof BehaviorSchema>;
export type BehaviorId = z.infer<typeof BehaviorIdSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type UnitStatus = z.infer<typeof UnitStatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Parse + cross-reference validate a manifest. Throws ManifestValidationError
 * on either Zod failure or dangling references between units and the
 * surface/precondition/behavior catalogs.
 */
export function parseManifest(input: unknown): Manifest {
  const result = ManifestSchema.safeParse(input);
  if (!result.success) {
    throw new ManifestValidationError(
      `Manifest schema invalid: ${result.error.message}`,
    );
  }
  const manifest = result.data;

  const surfaceIds = new Set(manifest.surfaces.map((s) => s.id));
  const preconditionIds = new Set(manifest.preconditions.map((p) => p.id));
  const behaviorIds = new Set(manifest.behaviors.map((b) => b.id));

  const errors: string[] = [];
  for (const unit of manifest.units) {
    if (!surfaceIds.has(unit.surface)) {
      errors.push(`unit ${unit.id}: surface ${unit.surface} not in surfaces[]`);
    }
    if (!preconditionIds.has(unit.precondition)) {
      errors.push(
        `unit ${unit.id}: precondition ${unit.precondition} not in preconditions[]`,
      );
    }
    if (!behaviorIds.has(unit.behavior as BehaviorId)) {
      errors.push(`unit ${unit.id}: behavior ${unit.behavior} not in behaviors[]`);
    }
  }

  if (errors.length > 0) {
    throw new ManifestValidationError(
      `Manifest cross-reference invalid:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return manifest;
}
