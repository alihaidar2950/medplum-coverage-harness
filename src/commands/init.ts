import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configPath } from '../util/paths.js';
import { logger } from '../util/logger.js';

export default class Init extends Command {
  static override description =
    'Initialize the harness against a sibling medplum checkout. Validates <target>/packages/app/src exists and writes harness.config.json.';

  static override flags = {
    target: Flags.string({
      required: true,
      description: 'Path to the medplum repo root (e.g. ../medplum)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    const target = flags.target;
    const appSrc = path.join(target, 'packages/app/src');

    if (!fs.existsSync(appSrc)) {
      logger.error(`target ${target} does not contain packages/app/src`);
      this.exit(1);
    }

    const config = { target, scope: ['packages/app/src'] };
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
    logger.info(`wrote harness.config.json with target=${target}`);
  }
}
