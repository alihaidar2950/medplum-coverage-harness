import * as fs from 'node:fs';
import * as path from 'node:path';
import { readSection } from '../util/markdown.js';
import { harnessRoot } from '../util/paths.js';
import type { Manifest } from './manifest.js';

export interface RefValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate that every precondition.mock_setup_ref and behavior.assertion_ref
 * actually points to an existing `## <id>` section with a fenced code block
 * inside the referenced markdown file. Without this, a typo in the catalog
 * silently produces a prompt with literal "// TODO: snippet missing" text
 * sent to the agent — not the kind of failure that should be deferred to
 * close-time.
 */
export function validatePromptReferences(
  manifest: Manifest,
  rootDir: string = harnessRoot(),
): RefValidationResult {
  const errors: string[] = [];

  for (const pre of manifest.preconditions) {
    // Inline snippets bypass the ref check — the ref string is decorative.
    if (pre.mock_setup_snippet && pre.mock_setup_snippet.length > 0) continue;
    const err = checkRef(rootDir, pre.mock_setup_ref, 'precondition', pre.id);
    if (err) errors.push(err);
  }
  for (const beh of manifest.behaviors) {
    const err = checkRef(rootDir, beh.assertion_ref, 'behavior', beh.id);
    if (err) errors.push(err);
  }

  return { ok: errors.length === 0, errors };
}

function checkRef(
  rootDir: string,
  ref: string,
  kind: 'precondition' | 'behavior',
  id: string,
): string | undefined {
  if (!ref) return `${kind} ${id}: missing ref`;
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) {
    return `${kind} ${id}: malformed ref "${ref}", expected "<file>#<anchor>"`;
  }
  const filePart = ref.slice(0, hashIdx);
  const anchor = ref.slice(hashIdx + 1);
  if (!filePart || !anchor) {
    return `${kind} ${id}: malformed ref "${ref}", expected "<file>#<anchor>"`;
  }

  const filePath = path.isAbsolute(filePart) ? filePart : path.join(rootDir, filePart);
  if (!fs.existsSync(filePath)) {
    return `${kind} ${id}: ref file does not exist: ${filePart}`;
  }
  const section = readSection(filePath, anchor);
  if (section === undefined) {
    return `${kind} ${id}: anchor "${anchor}" not found or has no code block in ${filePart}`;
  }
  return undefined;
}
