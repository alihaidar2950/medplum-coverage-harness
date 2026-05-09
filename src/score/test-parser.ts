/**
 * Parse a test file and extract: imported components, render targets,
 * MockClient setup pattern, and assertion style. These three signals are
 * what the unit matcher consumes.
 */
export interface ParsedTest {
  filePath: string;
  importedComponents: string[];
  mockSetupSignature: string;
  assertionSignals: string[];
}

export function parseTestFile(_filePath: string): ParsedTest {
  throw new Error('TODO: implement test file parser');
}
