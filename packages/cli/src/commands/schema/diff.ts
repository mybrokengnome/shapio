import type { CliCommand } from '../../types.js';
import { COMMON_USAGE, parseSchemaOptions } from './options.js';
import { printResults, readSiteState, sendApply } from './sync.js';

/** `shapio schema diff`: what `apply` would do, per definition, without changing anything. */
export const schemaDiffCommand: CliCommand = {
  summary: 'Show what `shapio schema apply` would change on the instance (dry run)',
  usage: `shapio schema diff ${COMMON_USAGE} [--prune]`,
  run: async (args, io) => {
    const options = parseSchemaOptions(args, io);
    const state = await readSiteState(options, io);
    if (!state) {
      return 1;
    }
    const response = await sendApply(options, state, true, io);
    if (!response) {
      return 1;
    }
    printResults(response, state, io, false);
    const pending = response.results.filter((item) =>
      ['create', 'update', 'delete'].includes(item.decision.action),
    );
    io.stdout(
      pending.length === 0 ? 'Nothing to apply.\n' : `${pending.length} definition(s) would change.\n`,
    );
    return 0;
  },
};
