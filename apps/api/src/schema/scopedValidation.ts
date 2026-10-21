import {
  isModelDefinition,
  validateSchema,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';

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

const referencedIds = (definition: SchemaDefinition) => [
  ...(isModelDefinition(definition) ? (definition.implements ?? []) : []).map((id, position) => ({
    id,
    path: `/implements/${position}`,
  })),
  ...definition.fields.flatMap((field, index) => {
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
  }),
];

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

const describeScope = (siteId: string | null, siteKeys: ReadonlyMap<string, string> | undefined) =>
  siteId === null ? 'shared with all sites' : `on site "${siteKeys?.get(siteId) ?? siteId}"`;

/**
 * A model and the model it extends have the same scope: both shared, or both on the same site (plan
 * polymorphic-types D3). Otherwise one of the views would hold a child without its parent.
 */
const inheritanceScopeIssues = (
  proposed: readonly ScopedDefinition[],
  siteKeys: ReadonlyMap<string, string> | undefined,
): ValidationIssue[] => {
  const scopes = new Map(proposed.map((entry) => [entry.definition.id, entry]));
  return proposed.flatMap(({ definition, siteId }) => {
    if (!isModelDefinition(definition) || definition.extends === undefined) {
      return [];
    }
    const parent = scopes.get(definition.extends);
    if (!parent || parent.siteId === siteId) {
      return [];
    }
    return [
      {
        path: '/extends',
        code: 'INVALID_PARENT' as const,
        message: `"${parent.definition.apiKey}" is ${describeScope(parent.siteId, siteKeys)} and this type is ${describeScope(siteId, siteKeys)}; a type and the type it extends must be available in the same place`,
        definitionId: definition.id,
      },
    ];
  });
};

/**
 * An interface on a site may be implemented only by that site's models (plan interfaces, D3): another site's
 * model would hold it in a view where the interface does not exist. A shared model implementing a site's
 * interface is the shared-reference rule's (`sharedReferenceIssues`); a shared interface may have members on
 * any site.
 */
const interfaceScopeIssues = (
  proposed: readonly ScopedDefinition[],
  siteKeys: ReadonlyMap<string, string> | undefined,
): ValidationIssue[] => {
  const scopes = new Map(proposed.map((entry) => [entry.definition.id, entry]));
  return proposed.flatMap(({ definition, siteId }) =>
    !isModelDefinition(definition) || siteId === null
      ? []
      : (definition.implements ?? []).flatMap((interfaceId, position) => {
          const target = scopes.get(interfaceId);
          return target && target.siteId !== null && target.siteId !== siteId
            ? [
                {
                  path: `/implements/${position}`,
                  code: 'INVALID_INTERFACE' as const,
                  message: `"${target.definition.apiKey}" is ${describeScope(target.siteId, siteKeys)} and this type is ${describeScope(siteId, siteKeys)}; a site's interface can only be implemented by that site's types`,
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
  const scopeIssues = inheritanceScopeIssues(proposed, options.siteKeys);
  const sharedIssues = sharedReferenceIssues(proposed);
  const contractScopeIssues = interfaceScopeIssues(proposed, options.siteKeys);
  for (const found of [
    ...globalIdIssues(proposed),
    ...sharedIssues,
    ...scopeIssues,
    ...contractScopeIssues,
  ]) {
    add(found, null);
  }
  // A parent or an interface in another scope is missing from the view; the scope issue already says why.
  const misplaced = new Set(scopeIssues.map((found) => found.definitionId));
  const misplacedContract = new Set(
    [...sharedIssues, ...contractScopeIssues].map((found) => `${found.definitionId ?? ''} ${found.path}`),
  );
  const explained = (found: ValidationIssue) =>
    (found.code === 'UNKNOWN_PARENT' && misplaced.has(found.definitionId)) ||
    (found.code === 'UNKNOWN_INTERFACE' &&
      misplacedContract.has(`${found.definitionId ?? ''} ${found.path}`));
  for (const siteId of touchedViews(proposed, touched)) {
    const view = proposed
      .filter((entry) => entry.siteId === null || entry.siteId === siteId)
      .map((entry) => entry.definition);
    for (const found of validateSchema(view)) {
      if (!explained(found)) {
        add(found, siteId);
      }
    }
  }
  return [...issues.values()];
};

/** The definitions of a schema with their scopes, as the planner and `validateScoped` take them. */
export const scopedDefinitionsOf = (
  definitions: ReadonlyArray<{ definition: SchemaDefinition; siteId: string | null }>,
): ScopedDefinition[] => definitions.map(({ definition, siteId }) => ({ definition, siteId }));
