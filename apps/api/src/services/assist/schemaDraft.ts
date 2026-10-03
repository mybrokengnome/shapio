import {
  createStableId,
  foldApiKey,
  parseDefinition,
  validateSchema,
  type SchemaDefinition,
} from '@shapio/schema';
import type { Static } from 'typebox';
import { completeJson } from '../../assist/completion.js';
import {
  type DraftDefinitionSchema,
  type DraftFieldSchema,
  SchemaDraftAnswerSchema,
  schemaDraftPrompt,
} from '../../assist/prompts/schemaDraft.js';
import type { AssistServiceContext } from './context.js';
import { runAssist } from './runs.js';

type DraftDefinition = Static<typeof DraftDefinitionSchema>;
type DraftField = Static<typeof DraftFieldSchema>;

export type SchemaDraftInput = { description: string };
export type SchemaDraftResult = {
  /** Normalized definitions with new stable IDs, in an order where each one's references come first. */
  definitions: SchemaDefinition[];
  model: string;
};

type Resolved = { id: string; kind: string };
type Built = { definitions: SchemaDefinition[]; problems: string[] };

/** API ID (case-insensitive) → definition, new ones first so they win over nothing (collisions are reported). */
const referenceIndex = (
  existing: readonly SchemaDefinition[],
  drafts: readonly DraftDefinition[],
  ids: string[],
) => {
  const index = new Map<string, Resolved>();
  existing.forEach((definition) => index.set(foldApiKey(definition.apiKey), definition));
  drafts.forEach((draft, position) =>
    index.set(foldApiKey(draft.apiKey), { id: ids[position] as string, kind: draft.kind }),
  );
  return index;
};

const settingsOf = (
  field: DraftField,
  resolve: (apiKey: string, where: string) => string | undefined,
  where: string,
): Record<string, unknown> => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'richtext':
    case 'slug':
    case 'uid':
      return field.maxLength ? { maxLength: field.maxLength } : {};
    case 'enum':
      return { values: field.values ?? [], ...(field.multiple ? { multiple: true } : {}) };
    case 'media':
      return {
        ...(field.multiple ? { multiple: true } : {}),
        ...(field.allowedKinds?.length ? { allowedKinds: field.allowedKinds } : {}),
      };
    case 'relation':
      return {
        target: resolve(field.target ?? '', `${where}/target`) ?? '',
        cardinality: field.cardinality ?? 'one',
      };
    case 'component':
      return {
        component: resolve(field.component ?? '', `${where}/component`) ?? '',
        ...(field.repeatable ? { repeatable: true } : {}),
      };
    case 'dynamiczone':
      return {
        components: (field.components ?? []).map(
          (apiKey, index) => resolve(apiKey, `${where}/components/${index}`) ?? '',
        ),
      };
    default:
      return {};
  }
};

/** The draft as definition input: references resolved to stable IDs, model-only properties dropped on components. */
const toDefinitionInput = (
  draft: DraftDefinition,
  id: string,
  resolve: (apiKey: string, where: string) => string | undefined,
) => {
  const isModel = draft.kind !== 'component';
  const localized = isModel && Boolean(draft.localized);
  const fields = draft.fields.map((field, index) => ({
    id: createStableId(),
    apiKey: field.apiKey,
    label: field.label,
    type: field.type,
    ...(field.description ? { description: field.description } : {}),
    ...(field.required ? { required: true } : {}),
    ...(localized && field.localized ? { localized: true } : {}),
    settings: settingsOf(field, resolve, `${draft.apiKey}/fields/${index}`),
  }));
  const titleField = fields.find((field) => field.apiKey === draft.titleField);
  return {
    id,
    kind: draft.kind,
    apiKey: draft.apiKey,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(isModel ? { localized } : {}),
    fields,
    ...(titleField ? { display: { titleFieldId: titleField.id } } : {}),
  };
};

/** IDs of new definitions a definition refers to (relations, components, zones). */
const referencesOf = (definition: SchemaDefinition): string[] =>
  definition.fields.flatMap((field) => {
    switch (field.type) {
      case 'relation':
        return [field.settings.target];
      case 'component':
        return [field.settings.component];
      case 'dynamiczone':
        return field.settings.components;
      default:
        return [];
    }
  });

/**
 * Orders definitions so each one's references to other new definitions come first (the admin saves them
 * one draft at a time, and each draft is validated against the ones before it). A cycle is a problem.
 */
const dependencyOrder = (definitions: readonly SchemaDefinition[]): Built => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const ordered: SchemaDefinition[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const problems: string[] = [];
  const visit = (definition: SchemaDefinition, path: string[]) => {
    const current = state.get(definition.id);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      problems.push(
        `the new definitions ${[...path, definition.apiKey].join(' → ')} reference each other in a cycle; leave one of those references out`,
      );
      return;
    }
    state.set(definition.id, 'visiting');
    for (const id of referencesOf(definition)) {
      const target = byId.get(id);
      if (target && target.id !== definition.id) {
        visit(target, [...path, definition.apiKey]);
      }
    }
    state.set(definition.id, 'done');
    ordered.push(definition);
  };
  definitions.forEach((definition) => visit(definition, []));
  return { definitions: ordered, problems };
};

/** The model's answer as validated definitions, or the problems to send back for one repair. */
export const buildDefinitions = (
  existing: readonly SchemaDefinition[],
  drafts: readonly DraftDefinition[],
): Built => {
  const ids = drafts.map(() => createStableId());
  const index = referenceIndex(existing, drafts, ids);
  const problems: string[] = [];
  const resolve = (apiKey: string, where: string) => {
    const found = index.get(foldApiKey(apiKey));
    if (!found) {
      problems.push(`${where}: no definition has the API ID "${apiKey}"`);
    }
    return found?.id;
  };
  const parsed: SchemaDefinition[] = [];
  drafts.forEach((draft, position) => {
    const result = parseDefinition(toDefinitionInput(draft, ids[position] as string, resolve));
    if (result.ok) {
      parsed.push(result.definition);
    } else {
      result.issues.forEach((found) => problems.push(`${draft.apiKey}${found.path}: ${found.message}`));
    }
  });
  if (problems.length > 0) {
    return { definitions: [], problems };
  }
  const newIds = new Set(ids);
  const byId = new Map(parsed.map((definition) => [definition.id, definition]));
  const schemaIssues = validateSchema([...existing, ...parsed]).filter(
    (found) => found.definitionId === undefined || newIds.has(found.definitionId),
  );
  if (schemaIssues.length > 0) {
    return {
      definitions: [],
      problems: schemaIssues.map(
        (found) =>
          `${found.definitionId ? (byId.get(found.definitionId)?.apiKey ?? '') : ''}${found.path}: ${found.message}`,
      ),
    };
  }
  return dependencyOrder(parsed);
};

/**
 * Proposed definitions from a description (`schema.create`). Validated against the active schema with one
 * repair turn; writes nothing (the admin saves them as drafts into a change set).
 */
export const draftSchema = (
  context: AssistServiceContext,
  input: SchemaDraftInput,
): Promise<SchemaDraftResult> => {
  const existing = context.snapshot.definitions.map((active) => active.definition);
  const prompt = schemaDraftPrompt({
    existing: existing.map((definition) => ({
      apiKey: definition.apiKey,
      kind: definition.kind,
      label: definition.label,
    })),
    locales: context.snapshot.locales.map((locale) => locale.code),
  });
  return runAssist(
    context,
    { action: 'schema_draft', metadata: { descriptionLength: input.description.length } },
    async (meter) => {
      let built: Built = { definitions: [], problems: [] };
      await completeJson(
        context.assist.provider,
        meter,
        {
          name: 'schema_draft',
          schema: SchemaDraftAnswerSchema,
          system: prompt.system,
          messages: [{ role: 'user', content: input.description }],
          ...(context.signal ? { signal: context.signal } : {}),
        },
        (answer) => {
          built = buildDefinitions(existing, answer.definitions);
          return built.problems;
        },
      );
      return { definitions: built.definitions, model: meter.model };
    },
  );
};
