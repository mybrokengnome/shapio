import { createHash } from 'node:crypto';
import {
  embeddedComponentIds,
  isComponentDefinition,
  isModelDefinition,
  type FieldDefinition,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { liveFields } from '../../../content/model.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { ModelVisibility, SchemaVisibility } from './visibility.js';

/**
 * What a caller's lens schema names (plan schema-lenses): the client's version of the workspace, under the
 * invariant today's schema keeps (`controllers/graphql.ts`): a delivery caller's schema never names a field or
 * model it cannot read today.
 *
 * - Admin callers (full visibility) see the client's version whole; models deleted since are read only
 *   (`readOnly`): their reads are empty and nothing can be written to them.
 * - Delivery callers see the models some policy allows them today, as today's schema does (reads when they
 *   may read, mutations as today). A model deleted since is not in their schema: a document naming it fails
 *   validation, as REST answers 404.
 * - A field that still exists today (by stable ID) is named when today's read mask allows it (today's grant and
 *   today's `public`); in inputs, when today's write mask does. Its old name and type are the client's.
 * - A field removed since is named only when it was public in the client's version and the caller's grant on
 *   the model today names no fields (`hasUnrestrictedGrant`: the grant's shape, never what its mask happens to
 *   cover today): it reads null.
 * - Component fields: a component that exists today names the fields public today (by ID); a field removed
 *   from it since, and every field of a component gone since, follow the removed-field rule for every model
 *   that embeds the component.
 */
const NO_FIELDS: ReadonlySet<string> = new Set();

const sorted = (ids: Iterable<string>) => [...ids].sort().join(',');

const digest = (text: string) => createHash('sha256').update(text).digest('base64url');

const keyOf = (
  models: ReadonlyMap<string, ModelVisibility>,
  components: ReadonlyMap<string, ReadonlySet<string>>,
): string => {
  const canonical = [...models]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, model]) =>
        `${id}|${model.readable ? 'r' : '-'}|${sorted(model.readFields)}|${sorted(model.writeFields)}`,
    );
  const componentLines = [...components]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, fields]) => `c:${id}|${sorted(fields)}`);
  return `lens:${digest([...canonical, ...componentLines].join('\n'))}`;
};

/** The client's fields named for one mask: today's grant by ID, removed fields when the grant names no fields. */
const namedFields = (
  model: ResolvedModelDefinition,
  today: ResolvedModelDefinition | undefined,
  mask: ReadonlySet<string>,
  /** The grant names no fields (`hasUnrestrictedGrant`): its shape, never what the mask covers today. */
  withRemoved: boolean,
): Set<string> => {
  const exists = new Set(today?.fields.map((field) => field.id) ?? []);
  return new Set(
    liveFields(model.fields)
      .filter((field) => (exists.has(field.id) ? mask.has(field.id) : withRemoved && field.public))
      .map((field) => field.id),
  );
};

/** The client's models deleted since its version. */
const goneModels = (view: SchemaSnapshot, current: SchemaSnapshot): Set<string> =>
  new Set(
    view.definitions.flatMap(({ definition }) =>
      isModelDefinition(definition) && !current.byId.has(definition.id) ? [definition.id] : [],
    ),
  );

/** The components a definition embeds in the client's version, transitively. */
const componentsOf = (view: SchemaSnapshot, root: SchemaDefinition): Set<string> => {
  const seen = new Set<string>();
  const queue = embeddedComponentIds(root);
  while (queue.length > 0) {
    const id = queue.pop() as string;
    const definition = view.byId.get(id)?.definition;
    if (seen.has(id) || !definition || !isComponentDefinition(definition)) {
      continue;
    }
    seen.add(id);
    queue.push(...embeddedComponentIds(definition));
  }
  return seen;
};

/**
 * The fields each of the client's components names: today's public ones by ID; removed ones (and a gone
 * component's) when public in the client's version and every model embedding it has a grant naming no fields.
 */
const componentFieldIds = (
  view: SchemaSnapshot,
  current: SchemaSnapshot,
  embedders: ReadonlyMap<string, boolean[]>,
): Map<string, ReadonlySet<string>> => {
  const named = new Map<string, ReadonlySet<string>>();
  for (const { definition } of view.definitions) {
    if (!isComponentDefinition(definition)) {
      continue;
    }
    const today = current.byId.get(definition.id)?.definition;
    const todayFields = new Map<string, FieldDefinition>(
      today && isComponentDefinition(today) ? today.fields.map((field) => [field.id, field]) : [],
    );
    const flags = embedders.get(definition.id) ?? [];
    const removedAllowed = flags.length > 0 && flags.every(Boolean);
    named.set(
      definition.id,
      new Set(
        liveFields(definition.fields)
          .filter((field) => {
            const now = todayFields.get(field.id);
            return now ? now.public && !now.deprecated : removedAllowed && field.public;
          })
          .map((field) => field.id),
      ),
    );
  }
  return named;
};

/**
 * `visibility` (today's, resolved over `current`) for a schema built from `view`, the client's version of the
 * same workspace.
 */
export const lensVisibility = (
  visibility: SchemaVisibility,
  view: SchemaSnapshot,
  current: SchemaSnapshot,
): SchemaVisibility => {
  if (visibility.models === null) {
    const gone = goneModels(view, current);
    return gone.size === 0
      ? visibility
      : { ...visibility, key: `${visibility.key}:lens:${digest(sorted(gone))}`, readOnly: gone };
  }
  const models = new Map<string, ModelVisibility>();
  /** Component ID → whether each model embedding it has a read grant naming no fields today. */
  const embedders = new Map<string, boolean[]>();
  for (const { definition } of view.definitions) {
    const today = visibility.models.get(definition.id);
    const model = isModelDefinition(definition) ? view.resolve(definition.id) : undefined;
    if (!today || !model) {
      continue;
    }
    const todayModel = current.resolve(definition.id);
    models.set(definition.id, {
      readable: today.readable,
      readFields: today.readable
        ? namedFields(model, todayModel, today.readFields, today.unrestrictedRead === true)
        : NO_FIELDS,
      writeFields: namedFields(model, todayModel, today.writeFields, today.unrestrictedWrite === true),
    });
    const open = today.readable && today.unrestrictedRead === true;
    for (const componentId of componentsOf(view, model)) {
      embedders.set(componentId, [...(embedders.get(componentId) ?? []), open]);
    }
  }
  const components = componentFieldIds(view, current, embedders);
  return {
    key: keyOf(models, components),
    models,
    componentFields: visibility.componentFields,
    componentFieldIds: components,
  };
};
