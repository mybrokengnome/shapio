import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';

/**
 * What an approval is pinned to (plan approval): a hash of what the set would ship, so an edit after the
 * approval makes it outdated. The set's own `version` is not used: it moves on every write (a title edit,
 * scheduling, the approval itself), while an entry's draft can change without touching the set at all.
 *
 * - Open form (every status but `shipped`): each item's ID, action and source revision, the current draft
 *   version of each item that publishes the entry's draft, and each schema draft's ID and row version.
 * - Shipped form: each item's ID, action and source revision, and the snapshot the set went live in. It reads
 *   nothing that can change after the ship, so a shipped set's approval never goes stale.
 */
export type FingerprintItem = {
  id: string;
  kind: string;
  action: string | null;
  source_revision_id: string | null;
  entry_id: string | null;
  locale: string | null;
};

export type DraftVersion = { entry_id: string; locale: string; version: number };

export type SchemaDraftVersion = { id: string; version: number };

const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** An item publishes the entry's current draft (not a fixed revision, not an unpublish). */
const publishesDraft = (item: FingerprintItem) =>
  item.kind === 'entry' && item.action === 'publish' && item.source_revision_id === null;

export const openFingerprint = (input: {
  items: readonly FingerprintItem[];
  draftVersions: readonly DraftVersion[];
  drafts: readonly SchemaDraftVersion[];
}): string => {
  const versionOf = (item: FingerprintItem) =>
    input.draftVersions.find((draft) => draft.entry_id === item.entry_id && draft.locale === item.locale)
      ?.version ?? null;
  return hash({
    form: 'open',
    items: byId(input.items).map((item) => [
      item.id,
      item.action,
      item.source_revision_id,
      publishesDraft(item) ? versionOf(item) : null,
    ]),
    drafts: byId(input.drafts).map((draft) => [draft.id, draft.version]),
  });
};

export const shippedFingerprint = (input: {
  items: readonly FingerprintItem[];
  shippedSeq: number;
}): string =>
  hash({
    form: 'shipped',
    shippedSeq: input.shippedSeq,
    items: byId(input.items).map((item) => [item.id, item.action, item.source_revision_id]),
  });

type Executor = Kysely<DB> | Transaction<DB>;

type FingerprintRow = Pick<ChangeSetRow, 'id' | 'status' | 'shipped_seq'>;

const draftEntryIds = (items: readonly FingerprintItem[]) => [
  ...new Set(items.filter(publishesDraft).flatMap((item) => (item.entry_id ? [item.entry_id] : []))),
];

/**
 * The current fingerprint of each set, in three queries for the whole page (items, draft versions, schema
 * drafts). A shipped set uses the shipped form once its snapshot is known.
 */
export const loadFingerprints = async (
  rows: readonly FingerprintRow[],
  executor: Executor,
): Promise<Map<string, string>> => {
  const ids = rows.map((row) => row.id);
  const items = await changeSetItemsRepository.listFingerprintFieldsForSets(ids, executor);
  const shipped = (row: FingerprintRow) => row.status === 'shipped' && row.shipped_seq !== null;
  const open = rows.filter((row) => !shipped(row));
  const openItems = items.filter((item) => open.some((row) => row.id === item.change_set_id));
  // One after the other: inside a transaction both run on its one connection.
  const draftVersions = await changeSetItemsRepository.findDraftVersions(draftEntryIds(openItems), executor);
  const drafts = await schemaDraftsRepository.listVersionsForSets(
    open.map((row) => row.id),
    executor,
  );
  return new Map(
    rows.map((row) => {
      const ofSet = items.filter((item) => item.change_set_id === row.id);
      return [
        row.id,
        shipped(row)
          ? shippedFingerprint({ items: ofSet, shippedSeq: Number(row.shipped_seq) })
          : openFingerprint({
              items: ofSet,
              draftVersions,
              drafts: drafts.filter((draft) => draft.change_set_id === row.id),
            }),
      ];
    }),
  );
};

export const loadFingerprint = async (row: FingerprintRow, executor: Executor): Promise<string> =>
  (await loadFingerprints([row], executor)).get(row.id) ?? '';

type ApprovalRow = FingerprintRow & Pick<ChangeSetRow, 'approval_status' | 'approved_fingerprint'>;

const matches = (row: ApprovalRow, fingerprint: string | undefined) =>
  row.approval_status === 'approved' && row.approved_fingerprint === fingerprint;

/** Approved sets whose approval no longer matches what they hold (the view's `outdated`), for a whole page. */
export const findOutdated = async (
  rows: readonly ApprovalRow[],
  executor: Executor,
): Promise<Set<string>> => {
  const approved = rows.filter((row) => row.approval_status === 'approved');
  const fingerprints = await loadFingerprints(approved, executor);
  return new Set(approved.filter((row) => !matches(row, fingerprints.get(row.id))).map((row) => row.id));
};

/** Approved, and the fingerprint it was given for still matches what the set holds now. */
export const isApprovalCurrent = async (row: ApprovalRow, executor: Executor): Promise<boolean> =>
  row.approval_status === 'approved' && matches(row, await loadFingerprint(row, executor));
