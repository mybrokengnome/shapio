import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { describeDefinition, findDefinition, readSchema, summarizer } from '../definitions.js';
import { putDefinitionDraft } from '../schemaDrafts.js';
import { runTool } from './results.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const SHARED_DESCRIPTION =
  'For a new definition only: true shares it with all sites (needs schema permission on every site). ' +
  "Default false: it belongs to this server's site. An existing definition keeps its scope.";

const DEFINITION_DESCRIPTION =
  'A whole definition in Shapio\'s authored format: { kind: "collection" | "singleton" | "component" | ' +
  '"interface", apiKey, label, pluralApiKey? (collections, interfaces), extends? (collections), implements? ' +
  '(collections, singletons), localized?, draftAndPublish?, fields: [{ apiKey, label, type, required?, ' +
  'localized?, settings? }] }. IDs are optional: an existing definition keeps its IDs (matched by API ID). ' +
  'Relation targets, component references, extends and implements may be given as API IDs; a relation target ' +
  'may also be an interface, or "*" for any entry. A collection with extends inherits every field of that ' +
  "collection: list only its own fields, never an inherited one, and give it the parent's localized and " +
  'draftAndPublish. An interface stores nothing: its fields are a contract every type that implements it ' +
  'must have, with the same API ID, type and flags (no component, dynamic zone or unique fields). Read ' +
  'shapio://schema/{apiKey} to see the format of an existing one.';

/** The schema: list and read definitions, and draft changes into a change set (never activated here). */
export const registerSchemaTools = ({ server, client }: ToolContext) => {
  server.registerTool(
    'schema_list',
    {
      title: 'List content types',
      description:
        "Every model (collection, singleton), component and interface of this server's site (its own and the " +
        'ones shared with all sites) with its kind, API IDs, scope, version and fields (types only). A ' +
        'collection that extends another names it in extends and lists the inherited fields first, each with ' +
        "inheritedFrom. A type lists the interfaces it implements (its parents' too) in implements. An " +
        "interface's fields are its contract, and members lists the types that implement it. Delivery reads use " +
        "routeKey for collections (the plural API ID, nested under the parent's: posts/guides) and interfaces " +
        "(the plural API ID: its list holds every member's entries).",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () =>
      runTool(async () => {
        const schema = await readSchema(client);
        return {
          schemaVersion: schema.schemaVersion,
          definitions: schema.definitions.map(summarizer(schema)),
        };
      }),
  );

  server.registerTool(
    'schema_get',
    {
      title: 'Read a content type',
      description:
        'One definition in full (fields with settings), by API ID or stable ID, with its version. A collection ' +
        'that extends another holds only its own fields; extendsApiKey, routeKey and inheritedFields describe ' +
        "what it inherits. A type that implements interfaces names them in implementsApiKeys (its parents' " +
        "too). An interface's fields are its contract; routeKey and members describe its list.",
      inputSchema: z.object({
        apiKey: z.string().min(1).describe('API ID (or stable ID) of the definition'),
      }),
      annotations: READ_ONLY,
    },
    ({ apiKey }) =>
      runTool(async () => {
        const schema = await readSchema(client);
        return describeDefinition(schema, findDefinition(schema, apiKey));
      }),
  );

  server.registerTool(
    'schema_draft',
    {
      title: 'Draft a content type change',
      description:
        'Proposes a new or changed definition as a draft in a change set (a new set when changeSetId is ' +
        'omitted). Nothing changes on the live schema until a person reviews and ships the set. Returns the ' +
        'change set ID; read change_sets_review next.',
      inputSchema: z.object({
        definition: z.record(z.string(), z.unknown()).describe(DEFINITION_DESCRIPTION),
        changeSetId: z.string().optional().describe('An open change set; omit to start a new one'),
        title: z.string().min(1).max(200).optional().describe('Title of the new change set'),
        shared: z.boolean().optional().describe(SHARED_DESCRIPTION),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ definition, changeSetId, title, shared }) =>
      runTool(async () => {
        const apiKey = typeof definition.apiKey === 'string' ? definition.apiKey : 'draft';
        const setId =
          changeSetId ?? (await client.admin.changeSets.create({ title: title ?? `Schema: ${apiKey}` })).id;
        return putDefinitionDraft(client, setId, definition, { shared: shared ?? false });
      }),
  );

  server.registerTool(
    'change_sets_add_schema_draft',
    {
      title: 'Add a schema draft to a change set',
      description:
        "Puts a new or changed definition into an existing change set as a draft (replaces this set's " +
        'earlier draft of the same definition). Ships only when a person ships the set.',
      inputSchema: z.object({
        changeSetId: z.string().min(1),
        definition: z.record(z.string(), z.unknown()).describe(DEFINITION_DESCRIPTION),
        shared: z.boolean().optional().describe(SHARED_DESCRIPTION),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ changeSetId, definition, shared }) =>
      runTool(() => putDefinitionDraft(client, changeSetId, definition, { shared: shared ?? false })),
  );
};
