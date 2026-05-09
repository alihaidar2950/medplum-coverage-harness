import { Command } from '@oclif/core';
import { logger } from '../util/logger.js';

export default class Scan extends Command {
  static override description =
    'Discover routes/components and score coverage. Preserves the previous manifest, writes a new manifest and a scan report.';

  static override examples = ['<%= config.bin %> scan'];

  async run(): Promise<void> {
    logger.warn('not yet implemented: scan');
    logger.info(
      'expected behavior:\n' +
        '  1. preserve coverage.manifest.yaml as coverage.manifest.previous.yaml\n' +
        '  2. run discover() (routes, components, mock catalog)\n' +
        '  3. run score() (parse tests, match units, detect regressions)\n' +
        '  4. write coverage.manifest.yaml + reports/scan-<ISO>.md\n' +
        '  5. report header: gap counts by priority, regressions, new units, retired units',
    );
    this.exit(3);
  }
}
