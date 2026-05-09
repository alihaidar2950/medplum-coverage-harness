import * as fs from 'node:fs';

/**
 * Read a labeled section out of a Markdown file. Sections start with `## <id>`
 * and the value we return is the contents of the first fenced code block under
 * that heading. Returns undefined if either is missing.
 */
export function readSection(filePath: string, id: string): string | undefined {
  const raw = fs.readFileSync(filePath, 'utf8');
  const chunks = raw.split(/^## /m).slice(1);
  for (const chunk of chunks) {
    const newline = chunk.indexOf('\n');
    const heading = chunk.slice(0, newline === -1 ? undefined : newline).trim();
    if (heading !== id) continue;
    const body = chunk.slice(newline + 1);
    const fence = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/.exec(body);
    if (!fence) return undefined;
    return fence[1];
  }
  return undefined;
}
