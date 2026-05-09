import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoveredRoute } from './routes.js';

export interface ResolvedComponent extends DiscoveredRoute {
  /** Repo-relative path to the component file (e.g. "packages/app/src/SignInPage.tsx"). */
  componentFile: string;
}

/**
 * Resolve each route's `componentImportPath` (e.g. "./admin/BotsPage") to a real
 * file under packages/app/src. Tries `.tsx`, then `.ts`, then `index.tsx`. If
 * nothing exists, falls back to the unresolved guess so discovered_via still
 * carries provenance.
 */
export function resolveComponents(
  targetRepo: string,
  routes: DiscoveredRoute[],
): ResolvedComponent[] {
  const appSrcAbs = path.join(targetRepo, 'packages/app/src');
  return routes.map((r) => {
    const guess = guessComponentFile(appSrcAbs, r.componentImportPath);
    const repoRel = path.relative(targetRepo, guess.absPath).split(path.sep).join('/');
    return { ...r, componentFile: repoRel };
  });
}

function guessComponentFile(
  appSrcAbs: string,
  importPath: string,
): { absPath: string; resolved: boolean } {
  const rel = importPath.replace(/^\.\//, '');
  const candidates = [
    path.join(appSrcAbs, `${rel}.tsx`),
    path.join(appSrcAbs, `${rel}.ts`),
    path.join(appSrcAbs, rel, 'index.tsx'),
    path.join(appSrcAbs, rel, 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { absPath: c, resolved: true };
  }
  return { absPath: candidates[0], resolved: false };
}
