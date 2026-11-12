import { mediaKindOf, type FieldDefinition } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { ContentData } from '../../db/contentData.js';
import type { DB } from '../../db/types.js';
import * as contentGuardsRepository from '../../repositories/contentGuards.js';
import * as entriesRepository from '../../repositories/entries.js';
import { imageUsesOf } from '../health/imageUses.js';
import type { ContentModel } from '../model.js';
import {
  COMPONENT_KEY,
  isMissingValue,
  type MediaReferenceCheck,
  type RelationReference,
} from '../validator/index.js';
import { contentInvalid, pointer, type ContentIssue } from '../validator/issues.js';

type Executor = Kysely<DB> | Transaction<DB>;

type TargetOutcome = { relations: readonly RelationReference[]; media: readonly MediaReferenceCheck[] };

/**
 * `siteId`: the site of the entry being written. Relation targets and media must be on it (sites plan §H:
 * nothing crosses sites); another site's entry or asset is reported as missing, never as existing elsewhere.
 * `lock`: in a write transaction, media rows are held FOR SHARE until commit so an asset cannot be deleted
 * between the check and the reference rows the write adds. Read-only checks (the publish pre-flight) pass
 * `false` and take no locks.
 * `storedMediaIds`: assets the entry already held before this write. One of them that is gone (an owner
 * force-deleted it) is not reported as missing, so the entry stays editable and publishable; only media the
 * write adds must exist (documentation/media.md).
 */
export type TargetCheckOptions = {
  siteId: string;
  lock: boolean;
  storedMediaIds?: ReadonlySet<string>;
  /**
   * The relation targets the body itself names, by the position they are written at (`relationsByPath`). Given,
   * only those are checked in full (a live entry of the field's target, as always); a target at any other
   * position was put back by the server (a field the body did not send, a value it could not see and that was
   * carried over) and only has to be an entry of the site, deleted or not. Never "this ID is somewhere in the
   * entry": what a body sends is answered the same whatever the entry holds where the caller cannot see.
   */
  sentRelations?: ReadonlyMap<string, ReadonlySet<string>>;
};

/** The kind of target a field points at: an entry (relation) or an asset (media field). */
type TargetKind = 'relation' | 'media';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What `visit` returns to remove a value's key (`walkTargets`). */
const REMOVE = Symbol('remove');

/**
 * Walks every relation or media value of a document (storage form), components and zone items included, by its
 * JSON pointer in API IDs (`/cards/0/rel`, as the validator reports them): `visit` returns the value to write
 * there (undefined: unchanged; `REMOVE`: the key goes). `topLevel`: the value is an entry field's, not an item's.
 * Returns the document with those values.
 */
const walkTargets = (
  model: ContentModel,
  data: Readonly<ContentData>,
  kind: TargetKind,
  visit: (path: string, value: unknown, topLevel: boolean) => unknown,
): ContentData => {
  const walk = (
    fields: readonly FieldDefinition[],
    value: Readonly<Record<string, unknown>>,
    path: string,
  ): Record<string, unknown> => {
    let output: Record<string, unknown> | null = null;
    const set = (fieldId: string, next: unknown) => {
      if (next !== undefined && next !== value[fieldId]) {
        output ??= { ...value };
        if (next === REMOVE) {
          delete output[fieldId];
        } else {
          output[fieldId] = next;
        }
      }
    };
    for (const field of fields) {
      const fieldValue = value[field.id];
      if (fieldValue === undefined || fieldValue === null) {
        continue;
      }
      const at = pointer(path, field.apiKey);
      if (field.type === kind) {
        set(field.id, visit(at, fieldValue, path === ''));
      } else if (field.type === 'component') {
        const component = model.components.get(field.settings.component)?.definition;
        if (!component) {
          continue;
        }
        if (Array.isArray(fieldValue)) {
          const items = fieldValue.map((item: unknown, index) =>
            isRecord(item) ? walk(component.fields, item, pointer(at, index)) : item,
          );
          set(field.id, items.some((item, index) => item !== fieldValue[index]) ? items : undefined);
        } else if (isRecord(fieldValue)) {
          set(field.id, walk(component.fields, fieldValue, at));
        }
      } else if (field.type === 'dynamiczone' && Array.isArray(fieldValue)) {
        const items = fieldValue.map((item: unknown, index) => {
          const component = isRecord(item)
            ? model.components.get(String(item[COMPONENT_KEY]))?.definition
            : undefined;
          return component && isRecord(item) ? walk(component.fields, item, pointer(at, index)) : item;
        });
        set(field.id, items.some((item, index) => item !== fieldValue[index]) ? items : undefined);
      }
    }
    return output ?? value;
  };
  return walk(model.definition.fields, data, '');
};

/** The IDs one relation or media value names (one, or a list). */
const idsIn = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string');

/** The targets of one kind a document names, by position (`walkTargets`). */
const targetsByPath = (model: ContentModel, data: Readonly<ContentData>, kind: TargetKind) => {
  const byPath = new Map<string, Set<string>>();
  walkTargets(model, data, kind, (path, value) => {
    byPath.set(path, new Set(idsIn(value)));
    return undefined;
  });
  return byPath;
};

/**
 * The relation targets a document (storage form) names, by their JSON pointer in API IDs (`/cards/0/rel`, as the
 * validator reports them), components and zone items included.
 */
export const relationsByPath = (model: ContentModel, data: Readonly<ContentData>) =>
  targetsByPath(model, data, 'relation');

/**
 * A relation or media value without the IDs `keep` refuses (undefined: unchanged). One left empty is removed, as
 * the validator stores an empty value (absent), except at the top level of a patch (`asPatch`), where only null
 * clears a field.
 */
const keptTargets = (
  value: unknown,
  topLevel: boolean,
  asPatch: boolean,
  keep: (id: unknown) => boolean,
): unknown => {
  const kept = Array.isArray(value) ? value.filter(keep) : keep(value) ? value : null;
  if (Array.isArray(value) ? (kept as unknown[]).length === value.length : kept === value) {
    return undefined;
  }
  return !isMissingValue(kept) ? kept : topLevel && asPatch ? null : REMOVE;
};

/** Target IDs by the position (`walkTargets` path) they sit at. */
export type TargetPositions = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Stored data (storage form) without the given IDs at the given positions only (`withoutDeadPutBackTargets`'s
 * `dropped`), emptied values removed as stored: what the stored data would be without those targets, for
 * comparisons. A field the body did not send keeps its value, as the write keeps it.
 */
export const withoutTargetIds = (
  model: ContentModel,
  data: Readonly<ContentData>,
  positions: TargetPositions,
): ContentData =>
  (['relation', 'media'] as const).reduce(
    (current, kind) =>
      walkTargets(model, current, kind, (path, value, topLevel) =>
        keptTargets(value, topLevel, false, (id) => typeof id !== 'string' || !positions.get(path)?.has(id)),
      ),
    data as ContentData,
  );

/**
 * What a write stores of the targets the server put back: `data` is the patch (storage form) after the carry-over,
 * `sent` the patch as the body sent it. A relation target or media asset at a position the body did not name it
 * (kept behind what the caller read, or carried over with a field it cannot see) that is no longer live (a deleted
 * entry or asset, or none) is dropped, as a write that sends the read back without it drops it: dead references do
 * not accumulate, and nothing a write is checked against (`max`, `min`, required) counts them. What the body names
 * is left for `assertTargets` and the validator; unpublished entries and private assets stay. Only what the patch
 * holds is touched: a field the body did not send keeps its stored value. `dropped`: the IDs dropped, by position.
 */
export const withoutDeadPutBackTargets = async (
  executor: Executor,
  model: ContentModel,
  data: Readonly<ContentData>,
  sent: Readonly<ContentData>,
  siteId: string,
): Promise<{ data: Readonly<ContentData>; dropped: TargetPositions }> => {
  const dead = new Set<string>();
  for (const kind of ['relation', 'media'] as const) {
    const named = targetsByPath(model, sent, kind);
    const putBack = [
      ...new Set(
        [...targetsByPath(model, data, kind)].flatMap(([path, ids]) =>
          [...ids].filter((id) => !(named.get(path)?.has(id) ?? false)),
        ),
      ),
    ];
    if (putBack.length === 0) {
      continue;
    }
    const live = new Set(
      kind === 'relation'
        ? await liveIdsOfAnyModel(putBack, siteId, executor)
        : (await contentGuardsRepository.findLiveMedia(putBack, siteId, executor)).map((row) => row.id),
    );
    putBack.filter((id) => !live.has(id)).forEach((id) => dead.add(id));
  }
  const dropped = new Map<string, Set<string>>();
  if (dead.size === 0) {
    return { data, dropped };
  }
  // A dead ID is dropped only where it was put back: where the body names it, it stays for the checks to answer.
  const output = (['relation', 'media'] as const).reduce((current, kind) => {
    const named = targetsByPath(model, sent, kind);
    return walkTargets(model, current, kind, (path, value, topLevel) =>
      keptTargets(value, topLevel, true, (id) => {
        const keep = typeof id !== 'string' || !dead.has(id) || (named.get(path)?.has(id) ?? false);
        if (!keep) {
          dropped.set(path, (dropped.get(path) ?? new Set()).add(id));
        }
        return keep;
      }),
    );
  }, data as ContentData);
  return { data: output, dropped };
};

/** Every asset the given documents point at (media fields and rich-text images, components included). */
export const mediaIdsOf = (model: ContentModel, documents: readonly Readonly<ContentData>[]) =>
  new Set(documents.flatMap((data) => imageUsesOf(model, data).map((use) => use.assetId)));

/**
 * Live entries on the site among `ids`, whatever their model: a relation to any entry (plan interfaces,
 * decision 8). Entries belong to collections and singletons only, so no model predicate is needed.
 */
const liveIdsOfAnyModel = async (ids: readonly string[], siteId: string, executor: Executor) =>
  (await entriesRepository.findByIds(ids, executor))
    .filter((entry) => entry.deleted_at === null && entry.site_id === siteId)
    .map((entry) => entry.id);

/**
 * Relation values must point at live entries of the field's target model on the same site (brief §4:
 * invalid relation targets are rejected), or of any kind of it (plan polymorphic-types), of a member of an
 * interface or of any model (plan interfaces). The target may be a draft.
 */
const findRelationIssues = async (
  executor: Executor,
  references: readonly RelationReference[],
  siteId: string,
  sent?: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<ContentIssue[]> => {
  const named = (reference: RelationReference, id: string) =>
    !sent || (sent.get(reference.path)?.has(id) ?? false);
  // Put back by the server: it only has to be an entry of the site (a deleted one stays; a hand-edited ID with no
  // entry at all is refused rather than failing the write).
  const putBack = [
    ...new Set(references.flatMap((reference) => reference.entryIds.filter((id) => !named(reference, id)))),
  ];
  const known = new Set(
    (await entriesRepository.findByIds(putBack, executor))
      .filter((entry) => entry.site_id === siteId)
      .map((entry) => entry.id),
  );
  const byTarget = new Map<string, { modelIds: readonly string[] | null; ids: Set<string> }>();
  for (const reference of references) {
    const target = byTarget.get(reference.targetModelId) ?? {
      modelIds: reference.targetModelIds,
      ids: new Set<string>(),
    };
    reference.entryIds.filter((id) => named(reference, id)).forEach((id) => target.ids.add(id));
    byTarget.set(reference.targetModelId, target);
  }
  const live = new Set<string>();
  for (const [targetModelId, { modelIds, ids }] of byTarget) {
    const found =
      modelIds === null
        ? await liveIdsOfAnyModel([...ids], siteId, executor)
        : await entriesRepository.findLiveIds(modelIds, [...ids], siteId, executor);
    found.forEach((id) => live.add(`${targetModelId}:${id}`));
  }
  return references.flatMap((reference) =>
    reference.entryIds
      .filter((id) => (named(reference, id) ? !live.has(`${reference.targetModelId}:${id}`) : !known.has(id)))
      .map((id) => ({
        path: reference.path,
        code: 'RELATION_TARGET_MISSING' as const,
        message: reference.accepts
          ? `entry ${id} is not ${reference.accepts}`
          : `entry ${id} does not exist in the target model in this workspace`,
      })),
  );
};

/** Media values must be live assets of an allowed kind (rich-text images must be images). */
const findMediaIssues = async (
  executor: Executor,
  checks: readonly MediaReferenceCheck[],
  { lock, siteId, storedMediaIds }: TargetCheckOptions,
): Promise<ContentIssue[]> => {
  const ids = [...new Set(checks.flatMap((check) => check.assetIds))];
  if (ids.length === 0) {
    return [];
  }
  const rows =
    lock && executor.isTransaction
      ? await contentGuardsRepository.lockLiveMedia(ids, siteId, executor as Transaction<DB>)
      : await contentGuardsRepository.findLiveMedia(ids, siteId, executor);
  const live = new Map(rows.map((row) => [row.id, row.mime_type]));
  return checks.flatMap((check) =>
    check.assetIds.flatMap((id): ContentIssue[] => {
      const mimeType = live.get(id);
      if (mimeType === undefined) {
        return storedMediaIds?.has(id)
          ? []
          : [
              {
                path: check.path,
                code: 'MEDIA_MISSING',
                message: `media asset ${id} does not exist in this workspace`,
              },
            ];
      }
      if (check.allowedKinds && !check.allowedKinds.includes(mediaKindOf(mimeType))) {
        return [
          {
            path: check.path,
            code: 'NOT_ALLOWED',
            message: `must be ${check.allowedKinds.join(' or ')} media`,
          },
        ];
      }
      return [];
    }),
  );
};

/** Problems with a validated document's relation and media targets, without throwing. */
export const findTargetIssues = async (
  executor: Executor,
  outcome: TargetOutcome,
  options: TargetCheckOptions,
): Promise<ContentIssue[]> => [
  ...(await findRelationIssues(executor, outcome.relations, options.siteId, options.sentRelations)),
  ...(await findMediaIssues(executor, outcome.media, options)),
];

/**
 * Relation and media targets of a validated document on the entry's site, checked (and media locked) in the
 * write transaction.
 */
export const assertTargets = async (
  trx: Transaction<DB>,
  outcome: TargetOutcome,
  siteId: string,
  storedMediaIds?: ReadonlySet<string>,
  sentRelations?: ReadonlyMap<string, ReadonlySet<string>>,
) => {
  const issues = await findTargetIssues(trx, outcome, {
    siteId,
    lock: true,
    ...(storedMediaIds ? { storedMediaIds } : {}),
    ...(sentRelations ? { sentRelations } : {}),
  });
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
};
