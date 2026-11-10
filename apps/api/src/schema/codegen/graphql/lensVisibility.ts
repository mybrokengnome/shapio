import { createHash } from 'node:crypto';
import { isModelDefinition } from '@shapio/schema';
import { liveFields } from '../../../content/model.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { ModelVisibility, SchemaVisibility } from './visibility.js';

/**
 * What a caller's lens schema names (plan schema-lenses): the client's version of the workspace, with today's
 * visibility. A lens keeps old queries valid, so the client's fields stay in the schema where today's rules
 * would drop them, and read null:
 *
 * - Admin callers (full visibility) see the client's version whole.
 * - Delivery callers see the models they may read today, with the fields of today's read mask (by stable ID)
 *   plus every field the client's version had public: one removed since, made private since, or outside the
 *   caller's grant today. Those were the client's public contract; the projection (`content/read.ts`) leaves
 *   their values out and they resolve to null (the build's `lens` flag). A field private in the client's
 *   version is named only when today's mask grants it.
 * - Models deleted since the client's version stay in its schema (reads only, the fields it had public) for a
 *   caller who may read some model today, so a query naming one stays valid; their reads are empty
 *   (`lensReads.ts`). Models the caller may not read today are absent, as without a lens.
 * - Component fields follow the client's `public` flags; the projection checks today's.
 *
 * Mutations are never in a lens schema, so write masks are empty.
 */
const NO_FIELDS: ReadonlySet<string> = new Set();

const sorted = (ids: ReadonlySet<string>) => [...ids].sort().join(',');

const keyOf = (models: ReadonlyMap<string, ModelVisibility>): string => {
  const canonical = [...models]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, model]) => `${id}|${sorted(model.readFields)}`)
    .join('\n');
  return `lens:${createHash('sha256').update(canonical).digest('base64url')}`;
};

/**
 * `visibility` (today's, resolved over `current`) widened for a schema built from `view`, the client's version
 * of the same workspace.
 */
export const lensVisibility = (
  visibility: SchemaVisibility,
  view: SchemaSnapshot,
  current: SchemaSnapshot,
): SchemaVisibility => {
  if (visibility.models === null) {
    return visibility;
  }
  const readsSomething = [...visibility.models.values()].some((model) => model.readable);
  const models = new Map<string, ModelVisibility>();
  for (const { definition } of view.definitions) {
    if (!isModelDefinition(definition)) {
      continue;
    }
    const model = view.resolve(definition.id);
    const today = visibility.models.get(definition.id);
    const gone = !current.byId.has(definition.id);
    if (!model || !(today?.readable || (gone && readsSomething))) {
      continue;
    }
    const granted = today?.readFields ?? NO_FIELDS;
    const readFields = new Set(
      liveFields(model.fields)
        .filter((field) => field.public || granted.has(field.id))
        .map((field) => field.id),
    );
    models.set(definition.id, { readable: true, readFields, writeFields: NO_FIELDS });
  }
  return { key: keyOf(models), models, componentFields: visibility.componentFields };
};
