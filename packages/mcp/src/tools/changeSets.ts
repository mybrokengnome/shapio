import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { runTool } from './results.js';

const SET_ID = z.string().min(1).describe('Change set ID');

/**
 * Change sets: the reviewable bundle of schema drafts and entry publications that ships as one snapshot.
 * Agents create and fill them and may ask for approval; shipping and approving are a person's call
 * (`change_sets_ship`, `change_sets_approve`, and `change_sets_request_changes` exist only with --allow-ship, and
 * the server also needs the token's role to hold changes.ship or changes.approve).
 */
export const registerChangeSetTools = ({ server, client, options }: ToolContext) => {
  server.registerTool(
    'change_sets_list',
    {
      title: 'List change sets',
      description: 'Change sets, newest first (every status but discarded unless status is given).',
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe('Comma-separated: open, scheduled, shipping, shipped, failed, discarded'),
        approval: z
          .string()
          .optional()
          .describe('Comma-separated approval states: none, requested, approved, changes_requested'),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (query) => runTool(() => client.admin.changeSets.list(query)),
  );

  server.registerTool(
    'change_sets_create',
    {
      title: 'Create a change set',
      description: 'An empty, open change set to collect schema drafts and entry publications for review.',
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ title, description }) =>
      runTool(() => client.admin.changeSets.create({ title, ...(description ? { description } : {}) })),
  );

  server.registerTool(
    'change_sets_add_entry',
    {
      title: 'Add an entry to a change set',
      description:
        "Proposes publishing (or unpublishing) one entry locale when the set ships. The entry's current draft " +
        'is what ships; the review shows the field diff against what is live.',
      inputSchema: z.object({
        changeSetId: SET_ID,
        model: z.string().min(1).describe("The model's API ID"),
        entryId: z.string().min(1),
        locale: z.string().optional().describe('Omit for non-localized models and the default locale'),
        action: z.enum(['publish', 'unpublish']).default('publish'),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ changeSetId, model, entryId, locale, action }) =>
      runTool(() =>
        client.admin.changeSets.addEntry(changeSetId, {
          modelKey: model,
          entryId,
          action,
          ...(locale ? { locale } : {}),
        }),
      ),
  );

  server.registerTool(
    'change_sets_review',
    {
      title: 'Review a change set',
      description:
        'The set (status, version, items) and its review: field diffs per entry, the schema plan per draft ' +
        '(breaking, destructive, conversions), blocking issues, warnings and the consumers of affected fields.',
      inputSchema: z.object({ changeSetId: SET_ID }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ changeSetId }) =>
      runTool(async () => {
        const [set, review] = await Promise.all([
          client.admin.changeSets.get(changeSetId),
          client.admin.changeSets.review(changeSetId),
        ]);
        return { set, review };
      }),
  );

  server.registerTool(
    'change_sets_request_approval',
    {
      title: 'Ask for approval of a change set',
      description:
        'Sends an open change set for approval, with an optional note for the approver. A site may require ' +
        'an approved set before it ships.',
      inputSchema: z.object({ changeSetId: SET_ID, note: z.string().max(2000).optional() }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ changeSetId, note }) =>
      runTool(() => client.admin.changeSets.requestApproval(changeSetId, note ? { note } : {})),
  );

  if (options.allowShip) {
    // Where a site requires approval, approving is what lets a set go live: the same guard as shipping.
    server.registerTool(
      'change_sets_approve',
      {
        title: 'Approve a change set',
        description:
          'Approves the set as it is now; any later edit makes the approval outdated. Only when the person you ' +
          "work for asked for it. Refused when the token's role lacks changes.approve.",
        inputSchema: z.object({ changeSetId: SET_ID, note: z.string().max(2000).optional() }),
        annotations: { destructiveHint: false, openWorldHint: false },
      },
      ({ changeSetId, note }) =>
        runTool(() => client.admin.changeSets.approve(changeSetId, note ? { note } : {})),
    );

    server.registerTool(
      'change_sets_request_changes',
      {
        title: 'Request changes to a change set',
        description:
          "Sends the set back with a note saying what to change. Refused when the token's role lacks " +
          'changes.approve.',
        inputSchema: z.object({ changeSetId: SET_ID, note: z.string().min(1).max(2000) }),
        annotations: { destructiveHint: false, openWorldHint: false },
      },
      ({ changeSetId, note }) => runTool(() => client.admin.changeSets.requestChanges(changeSetId, { note })),
    );

    server.registerTool(
      'change_sets_ship',
      {
        title: 'Ship a change set',
        description:
          'Makes the set live as one snapshot. Only when the person you work for asked for it. expectedVersion ' +
          'is the set version change_sets_review showed; breaking or destructive schema changes need the ' +
          "acknowledgement. Refused when the token's role lacks changes.ship.",
        inputSchema: z.object({
          changeSetId: SET_ID,
          expectedVersion: z.number().int().nonnegative(),
          acknowledgeBreaking: z.boolean().optional(),
          acknowledgeDestructive: z.boolean().optional(),
        }),
        annotations: { destructiveHint: true, openWorldHint: false },
      },
      ({ changeSetId, ...body }) => runTool(() => client.admin.changeSets.ship(changeSetId, body)),
    );
  }
};
