import { exportCommand } from './commands/export/index.js';
import { importCommand } from './commands/import/index.js';
import { schemaCommand } from './commands/schema/index.js';
import { statusCommand } from './commands/status.js';
import { typesCommand } from './commands/types/index.js';
import type { CliCommand } from './types.js';

/**
 * Commands that talk to a running instance over HTTP (never directly to its database). The `shapio` bin
 * in apps/api bundles these next to its local commands (start, migrate, worker, admin create).
 * Packages D, E and L add schema pull|diff|apply, export|import and types generate here.
 */
export const REMOTE_COMMANDS: Readonly<Record<string, CliCommand>> = {
  status: statusCommand,
  schema: schemaCommand,
  types: typesCommand,
  export: exportCommand,
  import: importCommand,
};

export type { CliCommand, CliIo } from './types.js';
