import { createStableId } from '../ids.js';
import { normalizeDefinition, type DefinitionInputWithIds, type FieldInputWithId } from '../normalize.js';
import {
  ComponentDefinitionInputSchema,
  ModelDefinitionInputSchema,
  type DefinitionInput,
  type FieldInput,
  type SchemaDefinition,
} from '../types/definitions.js';
import { SETTINGS_SCHEMAS } from '../types/settings.js';
import { foldApiKey } from './apiKey.js';
import { validateDefinition } from './definition.js';
import { issue, type ValidationIssue } from './issues.js';
import { collectSchemaErrors } from './typeboxIssues.js';

export type ParseDefinitionResult =
  { ok: true; definition: SchemaDefinition } | { ok: false; issues: ValidationIssue[] };

export type ParseDefinitionOptions = {
  /**
   * The current definition, if this is an edit. Fields sent without an `id` are matched to the current
   * field with the same API key (case-insensitive) and keep its ID; unmatched fields get a new ID.
   */
  previous?: SchemaDefinition;
  createId?: () => string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const structuralIssues = (raw: Record<string, unknown>): ValidationIssue[] => {
  const schema = raw.kind === 'component' ? ComponentDefinitionInputSchema : ModelDefinitionInputSchema;
  const issues = collectSchemaErrors(schema, raw).map((error) =>
    issue(error.path, 'INVALID_STRUCTURE', error.message),
  );
  if (issues.length > 0) {
    return issues;
  }
  const fields = raw.fields as FieldInput[];
  fields.forEach((field, index) => {
    const settingsSchema = SETTINGS_SCHEMAS[field.type];
    for (const error of collectSchemaErrors(
      settingsSchema,
      field.settings ?? {},
      `/fields/${index}/settings`,
    )) {
      issues.push(issue(error.path, 'INVALID_SETTINGS', error.message));
    }
  });
  return issues;
};

/** Fills in missing definition and field IDs (see ParseDefinitionOptions.previous). */
export const assignIds = (
  input: DefinitionInput,
  { previous, createId = createStableId }: ParseDefinitionOptions = {},
): DefinitionInputWithIds => {
  const explicitIds = new Set(input.fields.flatMap((field) => (field.id ? [field.id] : [])));
  const previousByKey = new Map(
    (previous?.fields ?? [])
      .filter((field) => !explicitIds.has(field.id))
      .map((field) => [foldApiKey(field.apiKey), field.id]),
  );
  const fields: FieldInputWithId[] = input.fields.map((field) => {
    if (field.id) {
      return { ...field, id: field.id };
    }
    const matched = previousByKey.get(foldApiKey(field.apiKey));
    previousByKey.delete(foldApiKey(field.apiKey));
    return { ...field, id: matched ?? createId() };
  });
  return { ...input, id: input.id ?? previous?.id ?? createId(), fields };
};

/**
 * The single entry point from untrusted input (request bodies, schema files) to a normalized definition:
 * structure, settings per data type, ID assignment, defaults, then the per-definition semantic checks.
 * Cross-definition rules (references, cycles, GraphQL name collisions) are `validateSchema`'s job.
 */
export const parseDefinition = (
  raw: unknown,
  options: ParseDefinitionOptions = {},
): ParseDefinitionResult => {
  if (!isObject(raw)) {
    return { ok: false, issues: [issue('', 'INVALID_STRUCTURE', 'a definition must be a JSON object')] };
  }
  const structural = structuralIssues(raw);
  if (structural.length > 0) {
    return { ok: false, issues: structural };
  }
  const definition = normalizeDefinition(assignIds(raw as DefinitionInput, options));
  const issues = validateDefinition(definition);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, definition };
};
