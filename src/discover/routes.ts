import * as path from 'node:path';
import {
  JsxElement,
  JsxSelfClosingElement,
  JsxOpeningElement,
  Node,
  Project,
} from 'ts-morph';

export interface DiscoveredRoute {
  /** Full path with parent prefix (e.g. "/admin/bots"). */
  route: string;
  /** React component identifier as written in JSX (e.g. "BotsPage"). */
  component: string;
  /** Module specifier from the import (e.g. "./admin/BotsPage"). */
  componentImportPath: string;
  /** 1-based source line of the <Route> JSX node. */
  line: number;
}

export function discoverRoutes(targetRepo: string): DiscoveredRoute[] {
  const appRoutesPath = path.join(targetRepo, 'packages/app/src/AppRoutes.tsx');
  return discoverRoutesFromFile(appRoutesPath);
}

/**
 * Walk an AppRoutes.tsx file, extract all <Route path="..." element={<Foo />}> nodes,
 * including nested children. Skips index-only routes (no path), Navigate-redirects,
 * and the top-level wrapper Route that only carries errorElement.
 */
export function discoverRoutesFromFile(filePath: string): DiscoveredRoute[] {
  const project = new Project({ skipFileDependencyResolution: true });
  const src = project.addSourceFileAtPath(filePath);

  const importMap = new Map<string, string>();
  for (const decl of src.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    for (const named of decl.getNamedImports()) {
      importMap.set(named.getName(), spec);
    }
    const def = decl.getDefaultImport();
    if (def) importMap.set(def.getText(), spec);
  }

  const results: DiscoveredRoute[] = [];

  function getOpening(
    node: JsxElement | JsxSelfClosingElement,
  ): JsxOpeningElement | JsxSelfClosingElement {
    return Node.isJsxElement(node) ? node.getOpeningElement() : node;
  }

  function isRoute(node: JsxElement | JsxSelfClosingElement): boolean {
    return getOpening(node).getTagNameNode().getText() === 'Route';
  }

  function attrString(
    opening: JsxOpeningElement | JsxSelfClosingElement,
    name: string,
  ): string | undefined {
    const a = opening.getAttribute(name);
    if (!a || !Node.isJsxAttribute(a)) return undefined;
    const init = a.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
    return undefined;
  }

  function elementComponentName(
    opening: JsxOpeningElement | JsxSelfClosingElement,
  ): string | undefined {
    const a = opening.getAttribute('element');
    if (!a || !Node.isJsxAttribute(a)) return undefined;
    const init = a.getInitializer();
    if (!init || !Node.isJsxExpression(init)) return undefined;
    const expr = init.getExpression();
    if (!expr) return undefined;
    if (Node.isJsxSelfClosingElement(expr)) return expr.getTagNameNode().getText();
    if (Node.isJsxElement(expr)) return expr.getOpeningElement().getTagNameNode().getText();
    return undefined;
  }

  function joinRoute(parent: string, child: string): string {
    if (child.startsWith('/')) return child;
    if (!parent || parent === '/') return '/' + child;
    return parent.replace(/\/$/, '') + '/' + child;
  }

  function walkRoute(node: JsxElement | JsxSelfClosingElement, parentPath: string): void {
    const opening = getOpening(node);
    const pathValue = attrString(opening, 'path');
    const componentName = elementComponentName(opening);

    const fullPath = pathValue !== undefined ? joinRoute(parentPath, pathValue) : parentPath;

    if (
      pathValue !== undefined &&
      componentName !== undefined &&
      componentName !== 'Navigate'
    ) {
      results.push({
        route: fullPath,
        component: componentName,
        componentImportPath: importMap.get(componentName) ?? '',
        line: node.getStartLineNumber(),
      });
    }

    if (Node.isJsxElement(node)) {
      for (const child of node.getJsxChildren()) {
        if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
          if (isRoute(child)) walkRoute(child, fullPath);
        }
      }
    }
  }

  src.forEachDescendant((node) => {
    if (!Node.isJsxElement(node) && !Node.isJsxSelfClosingElement(node)) return;
    if (!isRoute(node)) return;
    const parent = node.getParent();
    if (parent && Node.isJsxElement(parent)) {
      const parentTag = parent.getOpeningElement().getTagNameNode().getText();
      if (parentTag === 'Route') return;
    }
    walkRoute(node, '');
  });

  return results;
}
