import { ShapioApiError } from '@shapio/client';
import type { CliCommand, CliIo } from '../../types.js';
import { schemaApplyCommand } from './apply.js';
import { schemaDiffCommand } from './diff.js';
import { formatApiError } from './format.js';
import { UsageError } from './options.js';
import { schemaPullCommand } from './pull.js';
import { schemaScopeCommand } from './scope.js';

const SUBCOMMANDS: Readonly<Record<string, CliCommand>> = {
  pull: schemaPullCommand,
  diff: schemaDiffCommand,
  apply: schemaApplyCommand,
  scope: schemaScopeCommand,
};

const help = () =>
  `Usage:\n${Object.values(SUBCOMMANDS)
    .map((command) => `  ${command.usage}\n      ${command.summary}`)
    .join('\n')}\n`;

/** `shapio schema <pull|diff|apply|scope>`: git-like schema sync over HTTP with an admin API token. */
export const schemaCommand: CliCommand = {
  summary: 'Sync models and components with schema files: pull | diff | apply | scope',
  usage: 'shapio schema <pull|diff|apply|scope> [options]',
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
      if (error instanceof ShapioApiError) {
        // Refusals outside an apply (an unknown site, a scope change in use, a stale version): readable, not a stack.
        io.stderr(formatApiError(error, [], new Map()));
        return 1;
      }
      throw error;
    }
  },
};
