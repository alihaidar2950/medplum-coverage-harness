import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Node,
  Project,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';

export interface ParsedTest {
  filePath: string;
  /** Basename minus the `.test.tsx`/`.test.ts` suffix. Primary surface signal. */
  baseName: string;
  /** Identifiers brought in via `import { Foo } from '...'`. */
  importedComponents: string[];
  /** Profile-arg expressions found inside `new MockClient(...)`. */
  mockClientProfiles: MockClientProfile[];
  /** True when at least one `setActiveLoginOverride(...)` call appears. */
  hasSetActiveLoginOverride: boolean;
  /** Resource types created via `medplum.createResource({ resourceType: 'X', ... })`. */
  createdResourceTypes: string[];
  /** Each `test(...)`/`it(...)` block: name + body text. */
  testCases: TestCase[];
}

export interface MockClientProfile {
  /** What the literal looked like — `null`, `DrAliceSmith`, etc. or 'unknown'. */
  kind: 'null' | 'identifier' | 'unknown';
  /** When kind === 'identifier', the identifier's text (e.g. "DrAliceSmith"). */
  identifier?: string;
  /** When kind === 'unknown', the raw text of the argument for debugging. */
  rawText?: string;
}

export interface TestCase {
  name: string;
  bodyText: string;
}

/** Walk packages/app/src for *.test.tsx and *.test.ts files. */
export function discoverTestFiles(targetRepo: string): string[] {
  const root = path.join(targetRepo, 'packages/app/src');
  const out: string[] = [];
  walk(root, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && /\.test\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

const PROJECT = new Project({ skipFileDependencyResolution: true });

export function parseTestFile(filePath: string): ParsedTest {
  let src: SourceFile;
  const existing = PROJECT.getSourceFile(filePath);
  if (existing) {
    src = existing;
    src.refreshFromFileSystemSync();
  } else {
    src = PROJECT.addSourceFileAtPath(filePath);
  }

  const importedComponents: string[] = [];
  for (const decl of src.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      importedComponents.push(named.getName());
    }
    const def = decl.getDefaultImport();
    if (def) importedComponents.push(def.getText());
  }

  const mockClientProfiles: MockClientProfile[] = [];
  let hasSetActiveLoginOverride = false;
  const createdResourceTypes: string[] = [];

  src.forEachDescendant((node) => {
    if (Node.isNewExpression(node)) {
      const expr = node.getExpression();
      if (expr.getText() === 'MockClient') {
        const args = node.getArguments();
        if (args.length === 0) {
          mockClientProfiles.push({ kind: 'unknown', rawText: '<no-args>' });
        } else {
          const arg = args[0];
          if (Node.isObjectLiteralExpression(arg)) {
            mockClientProfiles.push(extractProfileFromObject(arg));
          } else {
            mockClientProfiles.push({ kind: 'unknown', rawText: arg.getText() });
          }
        }
      }
    }
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression().getText();
      if (callee.endsWith('.setActiveLoginOverride')) hasSetActiveLoginOverride = true;
      if (callee.endsWith('.createResource')) {
        const rt = readResourceType(node);
        if (rt) createdResourceTypes.push(rt);
      }
    }
  });

  const testCases: TestCase[] = [];
  src.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression().getText();
    if (callee !== 'test' && callee !== 'it') return;
    const args = node.getArguments();
    if (args.length < 1) return;
    const nameNode = args[0];
    let name = '';
    if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) {
      name = nameNode.getLiteralValue();
    } else {
      name = nameNode.getText();
    }
    const body = args[1];
    const bodyText = body ? body.getText() : '';
    testCases.push({ name, bodyText });
  });

  return {
    filePath,
    baseName: path.basename(filePath).replace(/\.test\.(tsx|ts)$/, ''),
    importedComponents,
    mockClientProfiles,
    hasSetActiveLoginOverride,
    createdResourceTypes,
    testCases,
  };
}

function extractProfileFromObject(obj: ObjectLiteralExpression): MockClientProfile {
  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName();
    if (name !== 'profile') continue;
    const init = prop.getInitializer();
    if (!init) continue;
    if (init.getKind() !== undefined && init.getText() === 'null') {
      return { kind: 'null' };
    }
    if (Node.isIdentifier(init)) {
      return { kind: 'identifier', identifier: init.getText() };
    }
    return { kind: 'unknown', rawText: init.getText() };
  }
  return { kind: 'unknown', rawText: '<no-profile-key>' };
}

function readResourceType(call: CallExpression): string | undefined {
  const args = call.getArguments();
  if (args.length === 0) return undefined;
  const a = args[0];
  if (!Node.isObjectLiteralExpression(a)) return undefined;
  for (const p of a.getProperties()) {
    if (!Node.isPropertyAssignment(p)) continue;
    if (p.getName() !== 'resourceType') continue;
    const init = p.getInitializer();
    if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
      return init.getLiteralValue();
    }
  }
  return undefined;
}
