import type { ContentFilter, ContentSort } from '@shapio/client';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { findDefinition, readSchema, routeKeyOf } from '../definitions.js';
import { runTool } from './results.js';

const MODEL = z.string().min(1).describe('The model\'s API ID (singular, e.g. "article")');
const LOCALE = z.string().min(1).optional().describe('Locale code; the default locale when omitted');
const PUBLISHED = z
  .boolean()
  .optional()
  .describe('Read published content through the delivery API instead of drafts (implied by snapshot)');
const SNAPSHOT = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe('Read published content as of publication snapshot N');

const QUERY = z.object({
  model: MODEL,
  filters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Filter tree by field API ID, e.g. { "title": { "$containsi": "launch" } }; $and/$or take lists',
    ),
  sort: z.array(z.object({ field: z.string().min(1), direction: z.enum(['asc', 'desc']) })).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  q: z.string().optional().describe('Free-text search over the title field'),
  locale: LOCALE,
  fields: z.array(z.string()).optional().describe('Top-level fields to return'),
  populate: z.array(z.string()).optional().describe('Relation paths to expand, e.g. "author"'),
  status: z
    .enum(['draft', 'published', 'modified'])
    .optional()
    .describe('Drafts only: entries in this status'),
  published: PUBLISHED,
  snapshot: SNAPSHOT,
});

const DATA = z
  .record(z.string(), z.unknown())
  .describe("Field values by API ID. Rich text is Shapio's JSON document format, never HTML.");

/** Entries: query and read (drafts or published), create and update drafts. Never publishes. */
export const registerContentTools = ({ server, client }: ToolContext) => {
  server.registerTool(
    'content_query',
    {
      title: 'Query entries',
      description:
        "A page of a model's entries. Drafts by default (what editors see); published=true or snapshot=N reads " +
        'what the delivery API serves.',
      inputSchema: QUERY,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ model, published, snapshot, status, filters, sort, ...rest }) =>
      runTool(async () => {
        const query = {
          ...rest,
          ...(filters ? { filters: filters as ContentFilter } : {}),
          ...(sort ? { sort: sort as ContentSort[] } : {}),
        };
        if (published || snapshot !== undefined) {
          const { definition } = findDefinition(await readSchema(client), model);
          const routeKey = routeKeyOf(definition);
          return definition.kind === 'singleton'
            ? client.delivery.singleton(routeKey, {
                ...(rest.locale ? { locale: rest.locale } : {}),
                ...(snapshot !== undefined ? { snapshot } : {}),
              })
            : client.delivery.list(routeKey, { ...query, ...(snapshot !== undefined ? { snapshot } : {}) });
        }
        return client.admin.content.list(model, { ...query, ...(status ? { status } : {}) });
      }),
  );

  server.registerTool(
    'content_get',
    {
      title: 'Read an entry',
      description:
        "One entry: its draft with every locale's status and version (send version back as expectedVersion " +
        'to content_update), or the published version when published=true or snapshot=N.',
      inputSchema: z.object({
        model: MODEL,
        id: z.string().min(1),
        locale: LOCALE,
        published: PUBLISHED,
        snapshot: SNAPSHOT,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ model, id, locale, published, snapshot }) =>
      runTool(async () => {
        if (published || snapshot !== undefined) {
          const { definition } = findDefinition(await readSchema(client), model);
          return client.delivery.get(routeKeyOf(definition), id, {
            ...(locale ? { locale } : {}),
            ...(snapshot !== undefined ? { snapshot } : {}),
          });
        }
        return client.admin.content.get(model, id, locale ? { locale } : {});
      }),
  );

  server.registerTool(
    'content_create',
    {
      title: 'Create a draft entry',
      description:
        'Creates an entry as a draft (never published). Validated by the server against the live model. ' +
        'Add it to a change set with change_sets_add_entry to propose publishing it.',
      inputSchema: z.object({ model: MODEL, data: DATA, locale: LOCALE }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ model, data, locale }) =>
      runTool(() => client.admin.content.create(model, { data, ...(locale ? { locale } : {}) })),
  );

  server.registerTool(
    'content_update',
    {
      title: 'Update a draft entry',
      description:
        "Saves changed fields into one locale's draft (absent fields are kept, null clears). expectedVersion is " +
        'the version content_get returned; a stale one is refused (CONTENT_VERSION_CONFLICT): read again and redo. ' +
        'Pass expectedVersion null to start a new locale of the entry.',
      inputSchema: z.object({
        model: MODEL,
        id: z.string().min(1),
        data: DATA,
        expectedVersion: z.number().int().nonnegative().nullable(),
        locale: LOCALE,
      }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ model, id, data, expectedVersion, locale }) =>
      runTool(() =>
        client.admin.content.update(model, id, { data, expectedVersion, ...(locale ? { locale } : {}) }),
      ),
  );
};
