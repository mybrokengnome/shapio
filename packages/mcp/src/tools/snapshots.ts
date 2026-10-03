import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { runTool } from './results.js';

/** Publication snapshots: the ledger, the diff between two, and restore (as a reviewable change set). */
export const registerSnapshotTools = ({ server, client }: ToolContext) => {
  server.registerTool(
    'snapshots_list',
    {
      title: 'List snapshots',
      description: 'The publication ledger, newest first: what went live, when, why and by whom.',
      inputSchema: z.object({
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (query) => runTool(() => client.admin.snapshots.list(query)),
  );

  server.registerTool(
    'snapshots_changes',
    {
      title: 'Changes between snapshots',
      description:
        'Which entries were published, updated or unpublished between snapshot "from" and "to" (default: now). ' +
        'Names entries, never values.',
      inputSchema: z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative().optional(),
        after: z.string().optional().describe('nextCursor of the previous page'),
        limit: z.number().int().positive().max(500).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (query) => runTool(() => client.snapshots.changes(query)),
  );

  server.registerTool(
    'snapshots_restore',
    {
      title: 'Propose restoring a snapshot',
      description:
        'Creates an open change set that would bring live content back to what snapshot N served. Nothing ' +
        'changes until a person ships it; the schema is never rolled back.',
      inputSchema: z.object({ seq: z.number().int().positive() }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ seq }) => runTool(() => client.admin.snapshots.restore(seq)),
  );
};
