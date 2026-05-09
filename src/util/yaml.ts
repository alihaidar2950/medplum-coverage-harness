import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { parseManifest, type Manifest } from '../schema/manifest.js';

export function readManifest(filePath: string): Manifest {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw);
  return parseManifest(parsed);
}

export function writeManifest(filePath: string, manifest: Manifest): void {
  parseManifest(manifest);
  const yaml = YAML.stringify(manifest, { lineWidth: 0 });
  fs.writeFileSync(filePath, yaml, 'utf8');
}
