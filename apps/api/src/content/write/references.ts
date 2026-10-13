import type { Kysely, Transaction } from 'kysely';
import type { ContentData } from '../../db/contentData.js';
import type { DB } from '../../db/types.js';
import * as contentGuardsRepository from '../../repositories/contentGuards.js';
import * as entriesRepository from '../../repositories/entries.js';
import { imageUsesOf } from '../health/imageUses.js';
import { mediaKindOf } from '../media.js';
import type { ContentModel } from '../model.js';
import type { MediaReferenceCheck, RelationReference } from '../validator/index.js';
import { contentInvalid, type ContentIssue } from '../validator/issues.js';

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
export type TargetCheckOptions = { siteId: string; lock: boolean; storedMediaIds?: ReadonlySet<string> };

/** Every asset the given documents point at (media fields and rich-text images, components included). */
export const mediaIdsOf = (model: ContentModel, documents: readonly Readonly<ContentData>[]) =>
  new Set(documents.flatMap((data) => imageUsesOf(model, data).map((use) => use.assetId)));

/**
 * Relation values must point at live entries of the field's target model on the same site (brief §4:
 * invalid relation targets are rejected), or of any kind of it (plan polymorphic-types). The target may be a
 * draft.
 */
const findRelationIssues = async (
  executor: Executor,
  references: readonly RelationReference[],
  siteId: string,
): Promise<ContentIssue[]> => {
  const byTarget = new Map<string, { modelIds: readonly string[]; ids: Set<string> }>();
  for (const reference of references) {
    const known = byTarget.get(reference.targetModelId) ?? {
      modelIds: reference.targetModelIds,
      ids: new Set<string>(),
    };
    reference.entryIds.forEach((id) => known.ids.add(id));
    byTarget.set(reference.targetModelId, known);
  }
  const live = new Set<string>();
  for (const [targetModelId, { modelIds, ids }] of byTarget) {
    (await entriesRepository.findLiveIds(modelIds, [...ids], siteId, executor)).forEach((id) =>
      live.add(`${targetModelId}:${id}`),
    );
  }
  return references.flatMap((reference) =>
    reference.entryIds
      .filter((id) => !live.has(`${reference.targetModelId}:${id}`))
      .map((id) => ({
        path: reference.path,
        code: 'RELATION_TARGET_MISSING' as const,
        message: `entry ${id} does not exist in the target model on this site`,
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
                message: `media asset ${id} does not exist on this site`,
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
  ...(await findRelationIssues(executor, outcome.relations, options.siteId)),
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
) => {
  const issues = await findTargetIssues(trx, outcome, { siteId, lock: true, storedMediaIds });
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
};
