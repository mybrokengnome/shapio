import type { CliCommand, CliIo } from '../../types.js';
import { schemaApplyCommand } from './apply.js';
import { schemaDiffCommand } from './diff.js';
import { UsageError } from './options.js';
import { schemaPullCommand } from './pull.js';

const SUBCOMMANDS: Readonly<Record<string, CliCommand>> = {
  pull: schemaPullCommand,
  diff: schemaDiffCommand,
  apply: schemaApplyCommand,
};

const help = () =>
  `Usage:\n${Object.values(SUBCOMMANDS)
    .map((command) => `  ${command.usage}\n      ${command.summary}`)
    .join('\n')}\n`;

/** `shapio schema <pull|diff|apply>`: git-like schema sync over HTTP with an admin API token. */
export const schemaCommand: CliCommand = {
  summary: 'Sync models and components with schema files: pull | diff | apply',
  usage: 'shapio schema <pull|diff|apply> [options]',
  run: async (args: readonly string[], io: CliIo) => {
    const [name, ...rest] = args;
    const command = name ? SUBCOMMANDS[name] : undefined;
    if (!command) {
      (name && name !== 'help' && name !== '--help' ? io.stderr : io.stdout)(help());
      return name && name !== 'help' && name !== '--help' ? 1 : 0;
    }
    try {
      return await command.run(rest, io);
    } catch (error) {
      if (error instanceof UsageError) {
        io.stderr(`shapio schema ${name}: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  },
};
