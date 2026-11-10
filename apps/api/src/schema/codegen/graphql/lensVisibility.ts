import { createHash } from 'node:crypto';
import { isModelDefinition, type ResolvedModelDefinition } from '@shapio/schema';
import { liveFields } from '../../../content/model.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { ModelVisibility, SchemaVisibility } from './visibility.js';

/**
 * What a caller's lens schema names (plan schema-lenses): the client's version of the workspace, with today's
 * permissions. A lens keeps old documents valid, so the client's fields stay in the schema where today's rules
 * would drop them; their reads are null and their writes are refused by the write path:
 *
 * - Admin callers (full visibility) see the client's version whole.
 * - Delivery callers see the models some policy allows them today (read queries when they may read, mutations
 *   as for today's schema). Outputs, filters and sorts name the fields of today's read mask (by stable ID) plus
 *   every field the client's version had public: one removed since, made private since, or outside the
 *   caller's grant today. Those were the client's public contract; the projection (`content/read.ts`) leaves
 *   their values out and they resolve to null (the build's `lens` flag). Inputs likewise name today's write
 *   mask plus the client's public fields when the caller may write the model at all; the write path
 *   (`services/contentDeliveryWrites.ts`) refuses what cannot be written. A field private in the client's
 *   version is named only when today's masks grant it.
 * - Models deleted since the client's version stay in its schema, reads only (`readOnly`): for admin callers,
 *   and for a delivery caller who may read some model today, with the fields it had public. Their reads are
 *   empty (`lensReads.ts`); they have no mutations, since nothing can be written to them.
 * - Component fields follow the client's `public` flags; the projection and the write path check today's.
 */
const NO_FIELDS: ReadonlySet<string> = new Set();

const sorted = (ids: Iterable<string>) => [...ids].sort().join(',');

const digest = (text: string) => createHash('sha256').update(text).digest('base64url');

const keyOf = (models: ReadonlyMap<string, ModelVisibility>, readOnly: ReadonlySet<string>): string => {
  const canonical = [...models]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, model]) =>
        `${id}|${model.readable ? 'r' : '-'}|${sorted(model.readFields)}|${sorted(model.writeFields)}`,
    )
    .join('\n');
  return `lens:${digest(`${canonical}\n${sorted(readOnly)}`)}`;
};

/** The client's fields that are granted today, or were public in its version. */
const namedFields = (model: ResolvedModelDefinition, granted: ReadonlySet<string>, withPublic: boolean) =>
  new Set(
    liveFields(model.fields)
      .filter((field) => granted.has(field.id) || (withPublic && field.public))
      .map((field) => field.id),
  );

/** The client's models deleted since its version. */
const goneModels = (view: SchemaSnapshot, current: SchemaSnapshot): Set<string> =>
  new Set(
    view.definitions.flatMap(({ definition }) =>
      isModelDefinition(definition) && !current.byId.has(definition.id) ? [definition.id] : [],
    ),
  );

/**
 * `visibility` (today's, resolved over `current`) widened for a schema built from `view`, the client's version
 * of the same workspace.
 */
export const lensVisibility = (
  visibility: SchemaVisibility,
  view: SchemaSnapshot,
  current: SchemaSnapshot,
): SchemaVisibility => {
  const gone = goneModels(view, current);
  if (visibility.models === null) {
    return gone.size === 0
      ? visibility
      : { ...visibility, key: `${visibility.key}:lens:${digest(sorted(gone))}`, readOnly: gone };
  }
  const readsSomething = [...visibility.models.values()].some((model) => model.readable);
  const models = new Map<string, ModelVisibility>();
  const readOnly = new Set<string>();
  for (const { definition } of view.definitions) {
    if (!isModelDefinition(definition)) {
      continue;
    }
    const model = view.resolve(definition.id);
    const today = visibility.models.get(definition.id);
    if (!model) {
      continue;
    }
    if (today) {
      models.set(definition.id, {
        readable: today.readable,
        readFields: today.readable ? namedFields(model, today.readFields, true) : NO_FIELDS,
        writeFields: namedFields(model, today.writeFields, today.writeFields.size > 0),
      });
    } else if (gone.has(definition.id) && readsSomething) {
      models.set(definition.id, {
        readable: true,
        readFields: namedFields(model, NO_FIELDS, true),
        writeFields: NO_FIELDS,
      });
      readOnly.add(definition.id);
    }
  }
  return {
    key: keyOf(models, readOnly),
    models,
    componentFields: visibility.componentFields,
    ...(readOnly.size > 0 ? { readOnly } : {}),
  };
};
