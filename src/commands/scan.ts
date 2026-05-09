import { Command } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../util/logger.js';
import {
  ensureReportsDir,
  isoTimestampForFilename,
  manifestPath,
  previousManifestPath,
} from '../util/paths.js';
import { readManifest, writeManifest } from '../util/yaml.js';
import { scan as runScan } from '../score/index.js';
import { detectRegressions } from '../score/regression-detector.js';
import { renderScanReport } from '../report/scan-report.js';
import type { Manifest } from '../schema/manifest.js';

export default class Scan extends Command {
  static override description =
    'Discover routes/components and score coverage. Preserves the previous manifest, writes a new manifest and a scan report.';

  static override examples = ['<%= config.bin %> scan'];

  async run(): Promise<void> {
    try {
      const generatedAt = new Date().toISOString();

      let previous: Manifest | undefined;
      if (fs.existsSync(manifestPath())) {
        try {
          previous = readManifest(manifestPath());
        } catch (err) {
          logger.warn(
            'existing coverage.manifest.yaml failed validation; ignoring it for diff:',
            err instanceof Error ? err.message : String(err),
          );
        }
        // Preserve the file regardless of validation success.
        fs.copyFileSync(manifestPath(), previousManifestPath());
      }

      const fresh = await runScan({ generatedAt });
      const { manifest, diff } = detectRegressions(previous, fresh);

      writeManifest(manifestPath(), manifest);

      const reportsDir = ensureReportsDir();
      const reportPath = path.join(
        reportsDir,
        `scan-${isoTimestampForFilename(new Date(generatedAt))}.md`,
      );
      const report = renderScanReport({ manifest, previous, diff, generatedAt });
      fs.writeFileSync(reportPath, report, 'utf8');

      logger.info(
        `scan complete: ${manifest.surfaces.length} surfaces, ${manifest.units.length} units; ` +
          `regressions=${diff.regressionIds.length}, new=${diff.newIds.length}, retired=${diff.retiredIds.length}`,
      );
      logger.info(`manifest: ${manifestPath()}`);
      logger.info(`report:   ${reportPath}`);
    } catch (err) {
      logger.error('scan failed:', err instanceof Error ? err.message : String(err));
      this.exit(3);
    }
  }
}
