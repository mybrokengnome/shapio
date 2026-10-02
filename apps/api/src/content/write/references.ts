import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as contentGuardsRepository from '../../repositories/contentGuards.js';
import * as entriesRepository from '../../repositories/entries.js';
import { mediaKindOf } from '../media.js';
import type { MediaReferenceCheck, RelationReference } from '../validator/index.js';
import { contentInvalid, type ContentIssue } from '../validator/issues.js';

type Executor = Kysely<DB> | Transaction<DB>;

type TargetOutcome = { relations: readonly RelationReference[]; media: readonly MediaReferenceCheck[] };

/**
 * `lock`: in a write transaction, media rows are held FOR SHARE until commit so an asset cannot be deleted
 * between the check and the reference rows the write adds. Read-only checks (the publish pre-flight) pass
 * `false` and take no locks.
 */
export type TargetCheckOptions = { lock: boolean };

/**
 * Relation values must point at live entries of the field's target model (brief §4: invalid relation
 * targets are rejected). The target may be a draft.
 */
const findRelationIssues = async (
  executor: Executor,
  references: readonly RelationReference[],
): Promise<ContentIssue[]> => {
  const byModel = new Map<string, Set<string>>();
  for (const reference of references) {
    const ids = byModel.get(reference.targetModelId) ?? new Set<string>();
    reference.entryIds.forEach((id) => ids.add(id));
    byModel.set(reference.targetModelId, ids);
  }
  const live = new Set<string>();
  for (const [modelId, ids] of byModel) {
    (await entriesRepository.findLiveIds(modelId, [...ids], executor)).forEach((id) =>
      live.add(`${modelId}:${id}`),
    );
  }
  return references.flatMap((reference) =>
    reference.entryIds
      .filter((id) => !live.has(`${reference.targetModelId}:${id}`))
      .map((id) => ({
        path: reference.path,
        code: 'RELATION_TARGET_MISSING' as const,
        message: `entry ${id} does not exist in the target model`,
      })),
  );
};

/** Media values must be live assets of an allowed kind (rich-text images must be images). */
const findMediaIssues = async (
  executor: Executor,
  checks: readonly MediaReferenceCheck[],
  { lock }: TargetCheckOptions,
): Promise<ContentIssue[]> => {
  const ids = [...new Set(checks.flatMap((check) => check.assetIds))];
  if (ids.length === 0) {
    return [];
  }
  const rows =
    lock && executor.isTransaction
      ? await contentGuardsRepository.lockLiveMedia(ids, executor as Transaction<DB>)
      : await contentGuardsRepository.findLiveMedia(ids, executor);
  const live = new Map(rows.map((row) => [row.id, row.mime_type]));
  return checks.flatMap((check) =>
    check.assetIds.flatMap((id): ContentIssue[] => {
      const mimeType = live.get(id);
      if (mimeType === undefined) {
        return [{ path: check.path, code: 'MEDIA_MISSING', message: `media asset ${id} does not exist` }];
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
  ...(await findRelationIssues(executor, outcome.relations)),
  ...(await findMediaIssues(executor, outcome.media, options)),
];

/** Relation and media targets of a validated document, checked (and media locked) in the write transaction. */
export const assertTargets = async (trx: Transaction<DB>, outcome: TargetOutcome) => {
  const issues = await findTargetIssues(trx, outcome, { lock: true });
  if (issues.length > 0) {
    throw contentInvalid(issues);
  }
};
