import { validateSchema, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';

/**
 * Schema validation with per-site schemas (plan site-schema, rule 5): a change must leave every view it
 * touches valid. A view is the shared definitions plus one site's (or the shared ones alone), and API IDs,
 * route keys, generated GraphQL names and references only have to be unique or resolve within a view, so two
 * sites may each have a `post`. A shared change touches every view, which is how a shared API ID can never
 * collide with any site's. Stable IDs (definitions and fields) stay unique across the whole instance.
 */

/** A definition with its scope: `siteId` null when shared by every site. */
export type ScopedDefinition = { definition: SchemaDefinition; siteId: string | null };

/** An issue found in one site's view names the site (null scope issues name none). */
export type ScopedIssue = ValidationIssue & { siteKey?: string };

export type ScopedValidationOptions = {
  /** Site IDs to keys, to name the site an issue was found on. */
  siteKeys?: ReadonlyMap<string, string>;
};

const referencedIds = (definition: SchemaDefinition) =>
  definition.fields.flatMap((field, index) => {
    switch (field.type) {
      case 'relation':
        return [{ id: field.settings.target, path: `/fields/${index}/settings/target` }];
      case 'component':
        return [{ id: field.settings.component, path: `/fields/${index}/settings/component` }];
      case 'dynamiczone':
        return field.settings.components.map((id, position) => ({
          id,
          path: `/fields/${index}/settings/components/${position}`,
        }));
      default:
        return [];
    }
  });

/** Rule 3: a shared definition references shared definitions only (a site's are not on the other sites). */
const sharedReferenceIssues = (proposed: readonly ScopedDefinition[]): ValidationIssue[] => {
  const scopes = new Map(proposed.map((entry) => [entry.definition.id, entry]));
  return proposed
    .filter((entry) => entry.siteId === null)
    .flatMap(({ definition }) =>
      referencedIds(definition).flatMap(({ id, path }) => {
        const target = scopes.get(id);
        return target && target.siteId !== null
          ? [
              {
                path,
                code: 'INVALID_REFERENCE_TARGET' as const,
                message: `"${target.definition.apiKey}" belongs to one site; a definition shared with all sites can only reference shared definitions`,
                definitionId: definition.id,
              },
            ]
          : [];
      }),
    );
};

/** Definition and field IDs are stable identities: unique across every site, not only within a view. */
const globalIdIssues = (proposed: readonly ScopedDefinition[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const definitionIds = new Set<string>();
  const fieldOwners = new Map<string, SchemaDefinition>();
  for (const { definition } of proposed) {
    if (definitionIds.has(definition.id)) {
      issues.push({
        path: '/id',
        code: 'DUPLICATE_ID',
        message: 'another definition has the same ID',
        definitionId: definition.id,
      });
    }
    definitionIds.add(definition.id);
    definition.fields.forEach((field, index) => {
      const owner = fieldOwners.get(field.id);
      if (owner && owner.id !== definition.id) {
        issues.push({
          path: `/fields/${index}/id`,
          code: 'DUPLICATE_ID',
          message: `field ID is already used by "${owner.apiKey}"; field IDs are global`,
          definitionId: definition.id,
        });
      }
      fieldOwners.set(field.id, definition);
    });
  }
  return issues;
};

/**
 * The views a change touches: a site change its site's view; a shared change (or one that moves a
 * definition between scopes, which touches both) the shared definitions alone and every site's view.
 */
const touchedViews = (
  proposed: readonly ScopedDefinition[],
  touched: readonly (string | null)[],
): Array<string | null> => {
  const sites = new Set(touched.filter((scope): scope is string => scope !== null));
  if (touched.includes(null)) {
    for (const entry of proposed) {
      if (entry.siteId !== null) {
        sites.add(entry.siteId);
      }
    }
    return [null, ...[...sites].sort()];
  }
  return [...sites].sort();
};

const issueKey = (found: ValidationIssue) =>
  `${found.definitionId ?? ''}\u0000${found.path}\u0000${found.code}`;

/**
 * Validates the proposed full schema in every view `touched` reaches (scopes of the changed definitions,
 * before and after). Issues are deduplicated by definition, path and code, and tagged with the site's key
 * when found in a site's view.
 */
export const validateScoped = (
  proposed: readonly ScopedDefinition[],
  touched: readonly (string | null)[],
  options: ScopedValidationOptions = {},
): ScopedIssue[] => {
  const issues = new Map<string, ScopedIssue>();
  const add = (found: ValidationIssue, siteId: string | null) => {
    const key = issueKey(found);
    if (issues.has(key)) {
      return;
    }
    const siteKey = siteId === null ? undefined : options.siteKeys?.get(siteId);
    issues.set(key, siteKey ? { ...found, siteKey } : found);
  };
  for (const found of [...globalIdIssues(proposed), ...sharedReferenceIssues(proposed)]) {
    add(found, null);
  }
  for (const siteId of touchedViews(proposed, touched)) {
    const view = proposed
      .filter((entry) => entry.siteId === null || entry.siteId === siteId)
      .map((entry) => entry.definition);
    for (const found of validateSchema(view)) {
      add(found, siteId);
    }
  }
  return [...issues.values()];
};

/** The definitions of a schema with their scopes, as the planner and `validateScoped` take them. */
export const scopedDefinitionsOf = (
  definitions: ReadonlyArray<{ definition: SchemaDefinition; siteId: string | null }>,
): ScopedDefinition[] => definitions.map(({ definition, siteId }) => ({ definition, siteId }));
