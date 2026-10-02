import type { SchemaDefinition } from '../types/definitions.js';
import { foldApiKey } from './apiKey.js';
import { issue, type ValidationIssue } from './issues.js';
import {
  generatedNames,
  RESERVED_QUERY_NAMES,
  RESERVED_TYPE_NAMES,
  routeKeyOf,
  type GeneratedName,
} from './naming.js';

/** Deepest allowed nesting of components (a component inside a component inside ... ) below an entry. */
export const MAX_COMPONENT_DEPTH = 5;

const RESERVED_TYPES: ReadonlySet<string> = new Set(RESERVED_TYPE_NAMES.map(foldApiKey));
const RESERVED_QUERIES: ReadonlySet<string> = new Set(RESERVED_QUERY_NAMES.map(foldApiKey));

const withDefinition = (definition: SchemaDefinition, found: ValidationIssue): ValidationIssue => ({
  ...found,
  definitionId: definition.id,
});

const describeOrigin = (name: GeneratedName, byId: ReadonlyMap<string, SchemaDefinition>) => {
  const definition = byId.get(name.definitionId);
  const field = name.fieldId
    ? definition?.fields.find((candidate) => candidate.id === name.fieldId)
    : undefined;
  return field ? `${definition?.apiKey ?? '?'}.${field.apiKey}` : (definition?.apiKey ?? '?');
};

/** The API IDs a definition claims in the shared case-insensitive namespace, with their issue paths. */
const claimedKeys = (definition: SchemaDefinition): Array<{ key: string; path: string; plural: boolean }> => {
  const keys = [{ key: definition.apiKey, path: '/apiKey', plural: false }];
  const plural = definition.kind === 'collection' ? routeKeyOf(definition) : '';
  if (plural) {
    keys.push({ key: plural, path: '/pluralApiKey', plural: true });
  }
  return keys;
};

const describeKey = ({ definition, key }: { definition: SchemaDefinition; key: string }) =>
  key === definition.apiKey ? `"${key}"` : `the plural API ID "${key}" of "${definition.apiKey}"`;

const checkIdentity = (definitions: readonly SchemaDefinition[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const keys = new Map<string, { definition: SchemaDefinition; key: string }>();
  const fieldOwners = new Map<string, SchemaDefinition>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      issues.push(
        withDefinition(definition, issue('/id', 'DUPLICATE_ID', 'another definition has the same ID')),
      );
    }
    ids.add(definition.id);
    // Plural API IDs share the namespace: `/api/content/posts` and the `posts` query must be unambiguous.
    for (const { key, path, plural } of claimedKeys(definition)) {
      const folded = foldApiKey(key);
      const clash = keys.get(folded);
      if (clash && clash.definition.id !== definition.id) {
        issues.push(
          withDefinition(
            definition,
            issue(
              path,
              'API_KEY_COLLISION',
              `${plural ? 'the plural API ID ' : ''}"${key}" collides with ${describeKey(clash)} (models and components share one case-insensitive namespace)`,
            ),
          ),
        );
      }
      if (!clash) {
        keys.set(folded, { definition, key });
      }
    }
    definition.fields.forEach((field, index) => {
      const owner = fieldOwners.get(field.id);
      if (owner && owner.id !== definition.id) {
        issues.push(
          withDefinition(
            definition,
            issue(
              `/fields/${index}/id`,
              'DUPLICATE_ID',
              `field ID is already used by "${owner.apiKey}"; field IDs are global`,
            ),
          ),
        );
      }
      fieldOwners.set(field.id, definition);
    });
  }
  return issues;
};

const checkGeneratedNames = (definitions: readonly SchemaDefinition[]): ValidationIssue[] => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, GeneratedName>();
  for (const definition of definitions) {
    for (const name of generatedNames(definition)) {
      const folded = `${name.namespace}:${foldApiKey(name.name)}`;
      const path = name.fieldId
        ? `/fields/${definition.fields.findIndex((field) => field.id === name.fieldId)}/apiKey`
        : `/${name.property ?? 'apiKey'}`;
      if (name.namespace === 'type' && RESERVED_TYPES.has(foldApiKey(name.name))) {
        issues.push(
          withDefinition(
            definition,
            issue(path, 'API_KEY_RESERVED', `generates the GraphQL type "${name.name}", which is reserved`),
          ),
        );
        continue;
      }
      if (name.namespace === 'query' && RESERVED_QUERIES.has(foldApiKey(name.name))) {
        issues.push(
          withDefinition(
            definition,
            issue(path, 'API_KEY_RESERVED', `generates the GraphQL query "${name.name}", which is reserved`),
          ),
        );
        continue;
      }
      const clash = seen.get(folded);
      if (clash && (clash.definitionId !== name.definitionId || clash.fieldId !== name.fieldId)) {
        issues.push(
          withDefinition(
            definition,
            issue(
              path,
              'GENERATED_NAME_COLLISION',
              `generates the GraphQL ${name.namespace} name "${name.name}", which "${describeOrigin(clash, byId)}" already generates`,
            ),
          ),
        );
        continue;
      }
      seen.set(folded, name);
    }
  }
  return issues;
};

/** Component IDs a definition embeds directly (component and dynamic-zone fields). */
export const embeddedComponentIds = (definition: SchemaDefinition): string[] =>
  definition.fields.flatMap((field) => {
    if (field.type === 'component') {
      return [field.settings.component];
    }
    if (field.type === 'dynamiczone') {
      return field.settings.components;
    }
    return [];
  });

const checkReferences = (definitions: readonly SchemaDefinition[]): ValidationIssue[] => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const issues: ValidationIssue[] = [];
  for (const definition of definitions) {
    definition.fields.forEach((field, index) => {
      const path = `/fields/${index}/settings`;
      const expectComponent = (id: string, at: string) => {
        const target = byId.get(id);
        if (!target) {
          issues.push(withDefinition(definition, issue(at, 'UNKNOWN_REFERENCE', 'refers to no component')));
        } else if (target.kind !== 'component') {
          issues.push(
            withDefinition(
              definition,
              issue(at, 'INVALID_REFERENCE_TARGET', `"${target.apiKey}" is a model, not a component`),
            ),
          );
        }
      };
      if (field.type === 'relation') {
        const target = byId.get(field.settings.target);
        if (!target) {
          issues.push(
            withDefinition(definition, issue(`${path}/target`, 'UNKNOWN_REFERENCE', 'refers to no model')),
          );
        } else if (target.kind !== 'collection') {
          issues.push(
            withDefinition(
              definition,
              issue(
                `${path}/target`,
                'INVALID_REFERENCE_TARGET',
                `relations must target a collection model; "${target.apiKey}" is a ${target.kind}`,
              ),
            ),
          );
        }
      }
      if (field.type === 'component') {
        expectComponent(field.settings.component, `${path}/component`);
      }
      if (field.type === 'dynamiczone') {
        const seen = new Set<string>();
        field.settings.components.forEach((id, componentIndex) => {
          const at = `${path}/components/${componentIndex}`;
          if (seen.has(id)) {
            issues.push(withDefinition(definition, issue(at, 'DUPLICATE_ID', 'component listed twice')));
          }
          seen.add(id);
          expectComponent(id, at);
        });
      }
    });
  }
  return issues;
};

/**
 * Longest chain of nested components below each definition, or a cycle. Depth 1 means the definition
 * embeds components that embed nothing.
 */
const checkNesting = (definitions: readonly SchemaDefinition[]): ValidationIssue[] => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const depthOf = new Map<string, number>();
  const issues: ValidationIssue[] = [];
  const reported = new Set<string>();

  const visit = (id: string, stack: string[]): number => {
    const known = depthOf.get(id);
    if (known !== undefined) {
      return known;
    }
    if (stack.includes(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].map(
        (member) => byId.get(member)?.apiKey ?? member,
      );
      const definition = byId.get(id);
      if (definition && !reported.has(id)) {
        reported.add(id);
        issues.push(
          withDefinition(
            definition,
            issue('/fields', 'COMPONENT_CYCLE', `components nest in a cycle: ${cycle.join(' → ')}`),
          ),
        );
      }
      return Number.POSITIVE_INFINITY;
    }
    const definition = byId.get(id);
    if (!definition) {
      return 0;
    }
    const children = embeddedComponentIds(definition).filter(
      (child) => byId.get(child)?.kind === 'component',
    );
    const depth =
      children.length === 0 ? 0 : 1 + Math.max(...children.map((child) => visit(child, [...stack, id])));
    depthOf.set(id, depth);
    return depth;
  };

  for (const definition of definitions) {
    const depth = visit(definition.id, []);
    if (Number.isFinite(depth) && depth > MAX_COMPONENT_DEPTH && definition.kind !== 'component') {
      issues.push(
        withDefinition(
          definition,
          issue(
            '/fields',
            'COMPONENT_TOO_DEEP',
            `components nest ${depth} levels deep; the limit is ${MAX_COMPONENT_DEPTH}`,
          ),
        ),
      );
    }
  }
  return issues;
};

/**
 * Cross-definition checks over a whole schema (every active definition with the proposed change applied):
 * unique IDs and API keys, GraphQL name collisions, relation and component targets, component cycles and
 * nesting depth. Each definition must already pass `validateDefinition`.
 */
export const validateSchema = (definitions: readonly SchemaDefinition[]): ValidationIssue[] => [
  ...checkIdentity(definitions),
  ...checkGeneratedNames(definitions),
  ...checkReferences(definitions),
  ...checkNesting(definitions),
];

/** Definitions that reference `id` (relations, components, dynamic zones). Used to block deletions. */
export const findReferencingDefinitions = (
  definitions: readonly SchemaDefinition[],
  id: string,
): SchemaDefinition[] =>
  definitions.filter(
    (definition) =>
      definition.id !== id &&
      definition.fields.some(
        (field) =>
          (field.type === 'relation' && field.settings.target === id) ||
          (field.type === 'component' && field.settings.component === id) ||
          (field.type === 'dynamiczone' && field.settings.components.includes(id)),
      ),
  );

/**
 * Models that embed a component directly or through other components, i.e. whose entries change shape
 * when the component does (brief §5: "editing a shared component must account for all dependent models").
 */
export const findDependentModels = (
  definitions: readonly SchemaDefinition[],
  componentId: string,
): SchemaDefinition[] => {
  const embeddedBy = new Map<string, SchemaDefinition[]>();
  for (const definition of definitions) {
    for (const child of embeddedComponentIds(definition)) {
      embeddedBy.set(child, [...(embeddedBy.get(child) ?? []), definition]);
    }
  }
  const models = new Map<string, SchemaDefinition>();
  const visited = new Set<string>();
  const queue = [componentId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const parent of embeddedBy.get(current) ?? []) {
      if (parent.kind === 'component') {
        queue.push(parent.id);
      } else {
        models.set(parent.id, parent);
      }
    }
  }
  return [...models.values()];
};
