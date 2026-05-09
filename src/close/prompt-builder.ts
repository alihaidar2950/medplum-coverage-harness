import * as fs from 'node:fs';
import * as path from 'node:path';
import { harnessRoot } from '../util/paths.js';
import { readSection } from '../util/markdown.js';
import type { Behavior, Precondition, Surface, Unit } from '../schema/manifest.js';

export { readSection };

export interface PromptInputs {
  unit: Unit;
  surface: Surface;
  precondition: Precondition;
  behavior: Behavior;
}

export interface BuiltPrompt {
  /** The fully-substituted prompt text passed to the agent. */
  text: string;
  /** Repo-relative test file path the agent is told to write. */
  expectedTestFile: string;
  /** surface.path + surface.name derived from surface.discovered_via. */
  surfacePath: string;
  surfaceName: string;
}

/**
 * Render prompts/close-gap.md with surface/precondition/behavior splices.
 * Snippet text comes from prompts/mock-setups.md (keyed by precondition.id)
 * and prompts/behavior-assertions.md (keyed by behavior.id).
 */
export function buildClosePrompt(inputs: PromptInputs): BuiltPrompt {
  const root = harnessRoot();
  const template = fs.readFileSync(path.join(root, 'prompts/close-gap.md'), 'utf8');
  const mockSetups = readSection(
    path.join(root, 'prompts/mock-setups.md'),
    inputs.precondition.id,
  );
  const assertion = readSection(
    path.join(root, 'prompts/behavior-assertions.md'),
    inputs.behavior.id,
  );

  const { path: surfacePath, name: surfaceName } = deriveSurfaceFileLocation(inputs.surface);
  const expectedTestFile = composeTestFilePath(surfacePath, surfaceName, inputs.behavior.id);

  // Substitute placeholders. {{surface.path}}/ is special-cased so an empty
  // path doesn't leave a leading slash.
  const text = template
    .replace(/\{\{\s*surface\.route\s*\}\}/g, inputs.surface.route)
    .replace(/\{\{\s*surface\.component\s*\}\}/g, inputs.surface.component)
    .replace(/\{\{\s*surface\.name\s*\}\}/g, surfaceName)
    .replace(/\{\{\s*surface\.path\s*\}\}\//g, surfacePath ? `${surfacePath}/` : '')
    .replace(/\{\{\s*surface\.path\s*\}\}/g, surfacePath)
    .replace(/\{\{\s*precondition\.id\s*\}\}/g, inputs.precondition.id)
    .replace(/\{\{\s*precondition\.description\s*\}\}/g, inputs.precondition.description)
    .replace(/\{\{\s*precondition\.mock_setup_snippet\s*\}\}/g, mockSetups ?? '// TODO: snippet missing')
    .replace(/\{\{\s*behavior\.id\s*\}\}/g, inputs.behavior.id)
    .replace(/\{\{\s*behavior\.description\s*\}\}/g, inputs.behavior.description)
    .replace(/\{\{\s*behavior\.assertion_guidance\s*\}\}/g, assertion ?? '// TODO: guidance missing');

  return { text, expectedTestFile, surfacePath, surfaceName };
}

/**
 * Surface ids encode the route, but the FILE path lives in `discovered_via`,
 * which we wrote at discover-time as `packages/app/src/<rel>.tsx:<line>`.
 * Strip the prefix and suffix, split on the last slash.
 */
export function deriveSurfaceFileLocation(surface: Surface): { path: string; name: string } {
  const m = /^packages\/app\/src\/(.+?)\.tsx(?::\d+)?$/.exec(surface.discovered_via);
  if (!m) return { path: '', name: surface.component };
  const rel = m[1];
  const idx = rel.lastIndexOf('/');
  if (idx === -1) return { path: '', name: rel };
  return { path: rel.slice(0, idx), name: rel.slice(idx + 1) };
}

export function composeTestFilePath(
  surfacePath: string,
  surfaceName: string,
  behaviorId: string,
): string {
  const dir = surfacePath ? `packages/app/src/${surfacePath}` : 'packages/app/src';
  return `${dir}/${surfaceName}.${behaviorId}.test.tsx`;
}

