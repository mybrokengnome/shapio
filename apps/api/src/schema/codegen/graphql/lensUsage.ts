import { isModelDefinition } from '@shapio/schema';
import { relationTargetOf } from '../../../content/relationTarget.js';
import type { FieldRead } from '../../../usage/aggregator.js';
import type { RequestLens } from '../../lens/views.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { OperationUsage } from './usageSelection.js';
import type { SchemaVisibility } from './visibility.js';

/**
 * Field usage of an operation run through a schema lens (plan schema-lenses): the lens schema maps its fields
 * to stable IDs, which are today's too, so reads count under today's fields. A field the lens reads as null
 * (gone since the client's version, or its values dropped) is never counted, nor a model gone since, nor a
 * field today's visibility hides (the lens schema still names it; it reads null); a read one level into a
 * relation counts when both the relation and the target's field still read something.
 */
const liveFieldsOf = (lens: RequestLens, current: SchemaSnapshot, visibility: SchemaVisibility) => {
  const memo = new Map<string, ReadonlySet<string>>();
  return (modelId: string): ReadonlySet<string> => {
    let live = memo.get(modelId);
    if (!live) {
      let definitionLens;
      try {
        definitionLens = lens.lensFor(modelId);
      } catch {
        // History that does not reach the version: the read failed, nothing to count.
        definitionLens = null;
      }
      const readable = visibility.models === null ? null : visibility.models.get(modelId)?.readFields;
      live = new Set(
        definitionLens && definitionLens.status !== 'gone' && current.byId.has(modelId)
          ? definitionLens.fields
              .filter((field) => field.kind !== 'null' && (readable === null || readable?.has(field.fieldId)))
              .map((field) => field.fieldId)
          : [],
      );
      memo.set(modelId, live);
    }
    return live;
  };
};

/** Today's models a relation field of `modelId` reads, for its target fields. */
const targetModelIds = (current: SchemaSnapshot, modelId: string, relationId: string): readonly string[] => {
  const field = current.resolve(modelId)?.fields.find((candidate) => candidate.id === relationId);
  if (!field || field.type !== 'relation') {
    return [];
  }
  const target = relationTargetOf(current, field);
  return target.kind === 'any'
    ? current.definitions.flatMap(({ definition }) => (isModelDefinition(definition) ? [definition.id] : []))
    : target.modelIds;
};

export const lensUsage = (
  usage: OperationUsage,
  lens: RequestLens,
  current: SchemaSnapshot,
  /** Today's visibility of the caller (not the lens schema's). */
  visibility: SchemaVisibility,
): OperationUsage => {
  const liveIn = liveFieldsOf(lens, current, visibility);
  const reads = new Map<string, FieldRead[]>();
  for (const [modelId, fieldReads] of usage.reads) {
    const live = liveIn(modelId);
    const kept = fieldReads.filter(({ path }) => {
      const [fieldId = '', targetFieldId] = path.split('.');
      if (!live.has(fieldId)) {
        return false;
      }
      return (
        targetFieldId === undefined ||
        targetModelIds(current, modelId, fieldId).some((targetId) => liveIn(targetId).has(targetFieldId))
      );
    });
    if (kept.length > 0) {
      reads.set(modelId, kept);
    }
  }
  return { reads, snapshot: usage.snapshot };
};
