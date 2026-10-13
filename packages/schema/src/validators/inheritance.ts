import {
  ancestorChain,
  createDefinitionIndex,
  MAX_INHERITANCE_DEPTH,
  type DefinitionIndex,
} from '../inheritance/resolve.js';
import { isModelDefinition, type ModelDefinition, type SchemaDefinition } from '../types/definitions.js';
import { foldApiKey } from './apiKey.js';
import { checkDisplay } from './definition.js';
import { issue, type ValidationIssue } from './issues.js';

/**
 * Cross-definition checks of model inheritance (plan polymorphic-types): the parent exists and is a
 * collection, no cycles, at most MAX_INHERITANCE_DEPTH levels, a child's flags equal its parent's, its own
 * fields' API IDs differ from every inherited one, and its display is valid against its resolved fields.
 * Issues are reported on the definition that has to change, on its own paths.
 */

const withDefinition = (definition: SchemaDefinition, found: ValidationIssue): ValidationIssue => ({
  ...found,
  definitionId: definition.id,
});

/** Whether following `extends` from the definition comes back to it. */
const isInCycle = (definition: ModelDefinition, index: DefinitionIndex): boolean => {
  const seen = new Set<string>();
  let current: SchemaDefinition | undefined = definition;
  while (current && isModelDefinition(current) && current.extends !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.extends === definition.id) {
      return true;
    }
    current = index.get(current.extends);
  }
  return false;
};

const parentIssues = (definition: ModelDefinition, index: DefinitionIndex): ValidationIssue[] => {
  if (definition.extends === undefined) {
    return [];
  }
  if (definition.kind !== 'collection') {
    return [
      issue(
        '/extends',
        'INVALID_PARENT',
        `only a collection can extend another; this is a ${definition.kind}`,
      ),
    ];
  }
  const chain = ancestorChain(definition, index.get);
  const parent = index.get(definition.extends);
  switch (chain.problem) {
    case 'missing':
      return chain.problemAt === definition.id
        ? [issue('/extends', 'UNKNOWN_PARENT', 'extends a type that does not exist')]
        : [];
    case 'invalid':
      if (chain.problemAt !== definition.id) {
        return [];
      }
      return [
        issue(
          '/extends',
          'INVALID_PARENT',
          definition.extends === definition.id
            ? 'a type cannot extend itself'
            : `can only extend a collection; "${parent?.apiKey ?? definition.extends}" is a ${parent?.kind ?? 'definition'}`,
        ),
      ];
    case 'cycle':
      return isInCycle(definition, index)
        ? [issue('/extends', 'INHERITANCE_CYCLE', 'types extend each other in a cycle')]
        : [];
    case 'tooDeep':
      return [
        issue(
          '/extends',
          'INHERITANCE_TOO_DEEP',
          `a family can have at most ${MAX_INHERITANCE_DEPTH} levels of types`,
        ),
      ];
    default:
      return [];
  }
};

const FLAGS = ['localized', 'draftAndPublish'] as const;

const flagIssues = (definition: ModelDefinition, parent: ModelDefinition): ValidationIssue[] =>
  FLAGS.filter((flag) => definition[flag] !== parent[flag]).map((flag) =>
    issue(
      `/${flag}`,
      'INHERITED_FLAG_MISMATCH',
      `must equal the parent's: set "${flag}" to ${String(parent[flag])}, as "${parent.apiKey}" has it`,
    ),
  );

const collisionIssues = (definition: ModelDefinition, index: DefinitionIndex): ValidationIssue[] => {
  const resolved = index.resolve(definition.id);
  const inherited = new Map<string, string>();
  for (const field of resolved?.fields ?? []) {
    if (field.inheritedFrom !== undefined) {
      inherited.set(foldApiKey(field.apiKey), index.get(field.inheritedFrom)?.apiKey ?? field.inheritedFrom);
    }
  }
  return definition.fields.flatMap((field, position) => {
    const owner = inherited.get(foldApiKey(field.apiKey));
    return owner === undefined
      ? []
      : [
          issue(
            `/fields/${position}/apiKey`,
            'INHERITED_FIELD_COLLISION',
            `"${field.apiKey}" is already a field of "${owner}", which this type extends (keys are case-insensitive)`,
          ),
        ];
  });
};

const GROUP_PATH = /^\/display\/groups\/(\d+)(\/.*)?$/;

/**
 * The display checked against the resolved fields. An issue counts when it is about a value the child sets
 * itself (the parent's own values were checked on the parent); group paths are moved to the child's groups.
 */
const displayIssues = (definition: ModelDefinition, index: DefinitionIndex): ValidationIssue[] => {
  const resolved = index.resolve(definition.id);
  if (!resolved) {
    return [];
  }
  const inheritedGroups = (resolved.display.groups?.length ?? 0) - (definition.display.groups?.length ?? 0);
  const own = definition.display as Record<string, unknown>;
  return checkDisplay(resolved).flatMap((found) => {
    const group = GROUP_PATH.exec(found.path);
    if (group) {
      const position = Number(group[1]) - inheritedGroups;
      return position < 0 ? [] : [{ ...found, path: `/display/groups/${position}${group[2] ?? ''}` }];
    }
    const property = found.path.split('/')[2];
    return property !== undefined && own[property] !== undefined ? [found] : [];
  });
};

/** Every inheritance problem of a schema (see the module comment). */
export const checkInheritance = (
  definitions: readonly SchemaDefinition[],
  index: DefinitionIndex = createDefinitionIndex(definitions),
): ValidationIssue[] =>
  definitions.flatMap((definition) => {
    if (!isModelDefinition(definition) || definition.extends === undefined) {
      return [];
    }
    const problems = parentIssues(definition, index);
    const parent = index.get(definition.extends);
    const checks =
      problems.length === 0 && parent && isModelDefinition(parent)
        ? [
            ...flagIssues(definition, parent),
            ...collisionIssues(definition, index),
            ...displayIssues(definition, index),
          ]
        : [];
    return [...problems, ...checks].map((found) => withDefinition(definition, found));
  });
