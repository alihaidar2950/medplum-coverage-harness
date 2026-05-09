import type { Behavior, Precondition, Surface, Unit } from '../schema/manifest.js';

export interface PromptInputs {
  unit: Unit;
  surface: Surface;
  precondition: Precondition;
  behavior: Behavior;
  mockSetupSnippet: string;
  assertionGuidance: string;
}

/**
 * Render prompts/close-gap.md with the unit's surface/precondition/behavior
 * substituted in. TODO: the actual template loader and substitution.
 */
export function buildClosePrompt(_inputs: PromptInputs): string {
  throw new Error('TODO: implement prompt builder');
}
