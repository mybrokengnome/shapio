import { randomUUID } from 'node:crypto';
import type { ChangeSet, ChangeSetSchemaItem, ShapioClient } from '@shapio/client';
import { isStableId, type DefinitionInput } from '@shapio/schema';
import { readSchema } from './definitions.js';

/** A definition as an agent writes it: the authored format, IDs optional, references by API ID allowed. */
export type DraftDefinition = Record<string, unknown> & { apiKey?: unknown; kind?: unknown; id?: unknown };

type FieldLike = { type?: unknown; settings?: Record<string, unknown> };

const schemaItemsOf = (set: ChangeSet) =>
  set.items.filter((item): item is ChangeSetSchemaItem => item.kind === 'schema');

/**
 * Relation targets and component references are stable IDs. Agents think in API IDs, so a reference that
 * is not an ID is looked up among the active definitions and the set's drafts (and this definition itself,
 * for a self-relation); anything unknown is left for the server to report.
 */
const resolveReferences = (definition: DraftDefinition, idsByApiKey: ReadonlyMap<string, string>) => {
  const resolve = (value: unknown) =>
    typeof value === 'string' && !isStableId(value) ? (idsByApiKey.get(value) ?? value) : value;
  const fields = Array.isArray(definition.fields) ? (definition.fields as FieldLike[]) : [];
  return {
    ...definition,
    fields: fields.map((field) => {
      const settings = field.settings;
      if (!settings) {
        return field;
      }
      if (field.type === 'relation') {
        return { ...field, settings: { ...settings, target: resolve(settings.target) } };
      }
      if (field.type === 'component') {
        return { ...field, settings: { ...settings, component: resolve(settings.component) } };
      }
      if (field.type === 'dynamiczone' && Array.isArray(settings.components)) {
        return { ...field, settings: { ...settings, components: settings.components.map(resolve) } };
      }
      return field;
    }),
  };
};

/**
 * Puts a definition into a change set as a draft: picks its stable ID (the active definition's, the set's
 * existing draft's, or a new one), its base version and the draft version to replace, then lets the server
 * parse, validate and plan it. Nothing goes live until a person ships the set.
 */
export const putDefinitionDraft = async (
  client: ShapioClient,
  changeSetId: string,
  definition: DraftDefinition,
) => {
  if (typeof definition.apiKey !== 'string' || typeof definition.kind !== 'string') {
    throw new Error('A definition needs at least "kind" (collection, singleton or component) and "apiKey"');
  }
  const [schema, set] = await Promise.all([readSchema(client), client.admin.changeSets.get(changeSetId)]);
  const drafts = schemaItemsOf(set);
  const apiKey = definition.apiKey;
  const explicitId = typeof definition.id === 'string' ? definition.id : undefined;
  const active = schema.definitions.find(
    ({ definition: candidate }) =>
      candidate.id === explicitId || (!explicitId && candidate.apiKey === apiKey),
  );
  const drafted = drafts.find(
    (item) => item.definitionId === explicitId || (!explicitId && item.apiKey === apiKey),
  );
  const id = explicitId ?? active?.definition.id ?? drafted?.definitionId ?? randomUUID();
  const idsByApiKey = new Map<string, string>([
    ...schema.definitions.map(({ definition: candidate }) => [candidate.apiKey, candidate.id] as const),
    ...drafts.map((item) => [item.apiKey, item.definitionId] as const),
    [apiKey, id],
  ]);
  const payload = resolveReferences({ ...definition, id }, idsByApiKey) as unknown as DefinitionInput;
  const draft = await client.admin.changeSets.putSchemaDraft(changeSetId, id, {
    category: definition.kind === 'component' ? 'component' : 'model',
    definition: payload,
    baseVersion: active?.version ?? null,
    ...(drafted ? { expectedDraftVersion: drafted.draftVersion } : {}),
  });
  return { changeSetId, definitionId: id, operation: draft.operation, draftVersion: draft.version, draft };
};
