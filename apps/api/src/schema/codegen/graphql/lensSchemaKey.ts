import { createHash } from 'node:crypto';
import { embeddedComponentIds, isInterfaceDefinition, isModelDefinition } from '@shapio/schema';
import type { SchemaSnapshot } from '../../snapshot.js';
import { modelInSchema, type SchemaVisibility } from './visibility.js';

/**
 * What a lens GraphQL schema is built from for one caller (plan schema-lenses), as a key: the revisions of the
 * definitions that can appear in it and of everything that shapes them (a model's ancestors and interfaces,
 * the kinds it has, the interfaces its relations target, the components any of those embed), with today's
 * locales. Not the whole view: versions that differ only in definitions this caller's schema never shows look
 * identical to it and share one schema, so walking such versions builds nothing.
 *
 * The workspace and the visibility key are the cache's (one cache per workspace and visibility).
 */
const keys = new WeakMap<object, Map<string, string>>();

const relationTargets = (view: SchemaSnapshot, id: string): string[] =>
  (view.resolve(id)?.fields ?? []).flatMap((field) =>
    field.type === 'relation' ? [field.settings.target] : [],
  );

const computeKey = (view: SchemaSnapshot, visibility: SchemaVisibility): string => {
  const shaping = new Set<string>();
  const kinds = new Set<string>();
  const add = (id: string) => {
    if (shaping.has(id) || !view.byId.has(id)) {
      return;
    }
    shaping.add(id);
    const definition = view.byId.get(id)?.definition;
    if (!definition) {
      return;
    }
    for (const next of [
      ...view.ancestors(id),
      ...view.interfacesOf(id),
      ...embeddedComponentIds(definition),
    ]) {
      add(next);
    }
  };
  for (const { definition } of view.definitions) {
    if (isModelDefinition(definition) && modelInSchema(visibility, definition.id)) {
      add(definition.id);
      // Whether a model has kinds decides its type (an interface), whatever the caller sees of them.
      view.childrenOf(definition.id).forEach((child) => kinds.add(`${definition.id}>${child}`));
      // A relation to an interface is typed by it; one to a model, by a model already counted when visible.
      relationTargets(view, definition.id)
        .filter((target) => {
          const targetDefinition = view.byId.get(target)?.definition;
          return targetDefinition !== undefined && isInterfaceDefinition(targetDefinition);
        })
        .forEach(add);
    }
  }
  // Interface definitions with a member in the schema are in it too.
  for (const { definition } of view.definitions) {
    if (
      isInterfaceDefinition(definition) &&
      !visibility.omitted?.has(definition.id) &&
      view.implementedBy(definition.id).some((id) => shaping.has(id))
    ) {
      add(definition.id);
    }
  }
  const revisions = [...shaping].map((id) => `${id}=${view.byId.get(id)?.revisionId ?? ''}`);
  return createHash('sha256')
    .update([...revisions.sort(), ...[...kinds].sort(), JSON.stringify(view.locales)].join('\n'))
    .digest('base64url');
};

/**
 * The key of the lens schema of `view` for `visibility`, computed once per (view, visibility key): a cached
 * lens view's definitions are shared by every request that reads it, so a cache hit hashes nothing.
 */
export const lensSchemaKey = (view: SchemaSnapshot, visibility: SchemaVisibility): string => {
  let byVisibility = keys.get(view.definitions);
  if (!byVisibility) {
    byVisibility = new Map();
    keys.set(view.definitions, byVisibility);
  }
  let key = byVisibility.get(visibility.key);
  if (key === undefined) {
    key = computeKey(view, visibility);
    byVisibility.set(visibility.key, key);
  }
  return key;
};
