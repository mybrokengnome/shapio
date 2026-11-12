import { isInterfaceDefinition, isModelDefinition, routeKeyOf } from '@shapio/schema';
import { getOperationAST, Kind, type DocumentNode, type SelectionSetNode } from 'graphql';
import type { UnavailableDefinition } from '../../lens/views.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import { fragmentsOf } from './complexity.js';
import { omittedDefinitions, type UnavailableDefinitions } from './lensVisibility.js';
import { collectionQueryName, mutationName, singleQueryName } from './names.js';
import { modelInSchema, modelReadable, type SchemaVisibility } from './visibility.js';

/**
 * Schema lenses (plan schema-lenses): a definition the client's version cannot be served for (history that
 * does not reach it) is left out of the lens schema rather than shown in a later shape. A document naming one of
 * its root fields fails validation there; this finds such a field, so the request is answered
 * `409 SCHEMA_VERSION_UNAVAILABLE` naming the definition and the oldest version that works, as REST answers.
 */
const MUTATIONS = ['create', 'update', 'delete', 'publish', 'unpublish'] as const;

/** Whether the caller may use a definition today: a model in its schema, an interface with a readable member. */
const accessibleToday = (view: SchemaSnapshot, today: SchemaVisibility, id: string): boolean => {
  const definition = view.byId.get(id)?.definition;
  if (definition && isInterfaceDefinition(definition)) {
    return view.implementedBy(id).some((member) => modelReadable(today, member));
  }
  return modelInSchema(today, id);
};

/**
 * Root field names of the omitted definitions the caller may use today, as the client's version named them,
 * each answered under the definition's own API ID (never the name of an ancestor or component that caused
 * it, which the caller may not see) with the oldest version that works.
 */
const rootNamesOf = (
  view: SchemaSnapshot,
  unavailable: UnavailableDefinitions,
  today: SchemaVisibility,
): Map<string, UnavailableDefinition> => {
  const names = new Map<string, UnavailableDefinition>();
  for (const [id, omission] of omittedDefinitions(view, unavailable)) {
    const definition = view.byId.get(id)?.definition;
    if (!definition || !accessibleToday(view, today, id)) {
      continue;
    }
    const cause = { ...omission, definitionId: id, apiKey: definition.apiKey };
    if (isModelDefinition(definition)) {
      names.set(singleQueryName(definition), cause);
      if (definition.kind === 'collection') {
        names.set(collectionQueryName(definition), cause);
      }
      MUTATIONS.forEach((prefix) => names.set(mutationName(prefix, definition), cause));
    } else if (isInterfaceDefinition(definition)) {
      names.set(singleQueryName(definition), cause);
      names.set(routeKeyOf(definition), cause);
    }
  }
  return names;
};

/** The first root field of the executed operation that names an omitted definition, with why. */
export const unavailableRootField = (
  view: SchemaSnapshot,
  unavailable: UnavailableDefinitions | undefined,
  /** The caller's visibility today: a definition it may not use is never named, unavailable or not. */
  today: SchemaVisibility,
  document: DocumentNode,
  operationName: string | null | undefined,
): UnavailableDefinition | undefined => {
  if (!unavailable || unavailable.size === 0) {
    return undefined;
  }
  const operation = getOperationAST(document, operationName ?? undefined);
  if (!operation) {
    return undefined;
  }
  const names = rootNamesOf(view, unavailable, today);
  if (names.size === 0) {
    return undefined;
  }
  const fragments = fragmentsOf(document.definitions);
  const seen = new Set<string>();
  const find = (selectionSet: SelectionSetNode): UnavailableDefinition | undefined => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        const cause = names.get(selection.name.value);
        if (cause) {
          return cause;
        }
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        const cause = find(selection.selectionSet);
        if (cause) {
          return cause;
        }
      } else if (!seen.has(selection.name.value)) {
        seen.add(selection.name.value);
        const fragment = fragments.get(selection.name.value);
        const cause = fragment ? find(fragment.selectionSet) : undefined;
        if (cause) {
          return cause;
        }
      }
    }
    return undefined;
  };
  return find(operation.selectionSet);
};
