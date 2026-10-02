import { parseDefinition, validateSchema, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';

/**
 * Validates a draft with the same validators the server runs (`parseDefinition` per definition, then
 * `validateSchema` over the whole proposed schema), so problems show inline before the plan is requested.
 * Only issues about the draft itself are returned.
 */
export const validateDraft = (
  draft: SchemaDefinition,
  base: SchemaDefinition,
  others: readonly SchemaDefinition[],
): ValidationIssue[] => {
  const parsed = parseDefinition(draft, { previous: base });
  if (!parsed.ok) {
    return parsed.issues;
  }
  // The draft goes last: collisions are reported on the later definition, which should be the draft.
  const schema = [...others.filter((definition) => definition.id !== draft.id), parsed.definition];
  return validateSchema(schema).filter(
    (found) => found.definitionId === undefined || found.definitionId === draft.id,
  );
};

/** Issues at `path` or below it (`/fields/2` matches `/fields/2/apiKey`). */
export const issuesUnder = (issues: readonly ValidationIssue[], path: string): ValidationIssue[] =>
  issues.filter((found) => found.path === path || found.path.startsWith(`${path}/`));

/** The JSON-pointer prefix of the field at `index`. */
export const fieldPath = (index: number) => `/fields/${index}`;
