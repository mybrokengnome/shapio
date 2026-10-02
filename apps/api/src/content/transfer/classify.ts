import { canonicalJson } from '@shapio/schema';
import type { TargetHeadRow } from '../../repositories/transferImport.js';
import type { EntryRecord, HeadRecordInBundle } from './format.js';

/**
 * How an import treats one bundle entry against the target (package L). Entries are matched by stable ID.
 * - `added`: the target has no such entry.
 * - `unchanged`: every head matches (same revision, same data, same set of locales and states).
 * - `updated`: the target's heads are all states the bundle knows (a revision in the bundle's history, with
 *   no autosaved changes on top), so moving them to the bundle's heads loses nothing: a fast-forward.
 * - `conflict`: the target changed the entry in a way the bundle does not know, the entry belongs to
 *   another model, or it was deleted on the target. An import refuses conflicts, like `schema apply`.
 */
export type EntryClassification =
  | { kind: 'added' }
  | { kind: 'unchanged' }
  | { kind: 'updated' }
  | { kind: 'conflict'; reason: EntryConflictReason; detail?: string };

export type EntryConflictReason = 'otherModel' | 'deletedOnTarget' | 'changedOnTarget';

type TargetEntry = { model_id: string; deleted_at: Date | null };

const headKey = (head: { locale: string; state: string }) => `${head.locale}:${head.state}`;

const sameData = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

const headMatches = (target: TargetHeadRow, bundle: HeadRecordInBundle) =>
  target.revision_id === bundle.revisionId &&
  (target.autosaved_at === null) === (bundle.autosavedAt === null) &&
  sameData(target.data, bundle.data);

export const classifyEntry = (
  entry: Pick<EntryRecord, 'modelId' | 'revisions' | 'heads'>,
  target: TargetEntry | undefined,
  targetHeads: readonly TargetHeadRow[],
): EntryClassification => {
  if (!target) {
    return { kind: 'added' };
  }
  if (target.model_id !== entry.modelId) {
    return {
      kind: 'conflict',
      reason: 'otherModel',
      detail: `the target entry belongs to model ${target.model_id}`,
    };
  }
  if (target.deleted_at !== null) {
    return { kind: 'conflict', reason: 'deletedOnTarget' };
  }
  const bundleHeads = new Map(entry.heads.map((head) => [headKey(head), head]));
  const unchanged =
    targetHeads.length === bundleHeads.size &&
    targetHeads.every((head) => {
      const bundle = bundleHeads.get(headKey(head));
      return bundle !== undefined && headMatches(head, bundle);
    });
  if (unchanged) {
    return { kind: 'unchanged' };
  }
  const known = new Set([
    ...entry.revisions.map((revision) => revision.id),
    ...entry.heads.map((head) => head.revisionId),
  ]);
  const unknown = targetHeads.find((head) => {
    const bundle = bundleHeads.get(headKey(head));
    if (bundle && headMatches(head, bundle)) {
      return false;
    }
    // An autosave holds changes no revision records, so only an identical head is safe to replace.
    return head.autosaved_at !== null || !known.has(head.revision_id);
  });
  return unknown
    ? {
        kind: 'conflict',
        reason: 'changedOnTarget',
        detail: `the target's ${unknown.locale} ${unknown.state} version is not in the bundle`,
      }
    : { kind: 'updated' };
};
