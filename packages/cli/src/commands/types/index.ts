import type { CliCommand, CliIo } from '../../types.js';
import { typesGenerateCommand } from './generate.js';

const SUBCOMMANDS: Readonly<Record<string, CliCommand>> = { generate: typesGenerateCommand };

const help = () =>
  `Usage:\n${Object.values(SUBCOMMANDS)
    .map((command) => `  ${command.usage}\n      ${command.summary}`)
    .join('\n')}\n`;

/** `shapio types <generate>`: contracts generated from the active schema. */
export const typesCommand: CliCommand = {
  summary: 'Generate TypeScript types from the active schema: generate',
  usage: 'shapio types generate [options]',
  run: async (args: readonly string[], io: CliIo) => {
    const [name, ...rest] = args;
    const command = name ? SUBCOMMANDS[name] : undefined;
    if (!command) {
      const asked = !name || name === 'help' || name === '--help';
      (asked ? io.stdout : io.stderr)(help());
      return asked ? 0 : 1;
    }
    return command.run(rest, io);
  },
};
