import type { Kysely, RawBuilder, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { selectSnapshotDiffRows } from '../db/snapshotDiffQuery.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * The snapshot diff (plan developer-face §5): which (entry, locale) pairs serve different live content at
 * publication sequence `to` than at `from`, in one query over `publication_log` (db/snapshotDiffQuery.ts).
 *
 * Candidates are the pairs whose live period opened (`from_seq`) or closed (`to_seq`) in `(from, to]`; only
 * those can differ. For each, the revision live at `from` and at `to` is "the row whose period contains
 * the sequence number" (`from_seq <= N and (to_seq is null or to_seq > N)`), the same rule `?snapshot=N`
 * reads with (content/compiler/compile.ts). Classification:
 *
 * | live at `from` | live at `to`       | change        |
 * |----------------|--------------------|---------------|
 * | no             | yes                | `published`   |
 * | yes            | no                 | `unpublished` |
 * | yes (R1)       | yes (R2, R2 ≠ R1)  | `updated`     |
 * | yes (R)        | yes (same R)       | dropped       |
 * | no             | no                 | dropped       |
 *
 * Entries are returned in entry-ID order with their changed locales grouped, paginated by keyset on the
 * entry ID (`after`). A page holds at most `limit` entries; `nextAfter` is set when more follow.
 *
 * Entry deletion closes the entry's live periods (it reads as `unpublished`); locale deletion removes that
 * locale's rows (history is rewritten, so a later diff no longer mentions the locale).
 */
export type SnapshotChangeKind = 'published' | 'updated' | 'unpublished';

export type SnapshotLocaleChange = {
  locale: string;
  change: SnapshotChangeKind;
  /** The revision live at `from` (null when the locale was not live then). */
  fromRevisionId: string | null;
  /** The revision live at `to` (null when the locale is not live then). */
  toRevisionId: string | null;
};

export type SnapshotEntryChange = {
  entryId: string;
  modelId: string;
  locales: SnapshotLocaleChange[];
};

export type SnapshotDiffQuery = {
  from: number;
  to: number;
  /** Keyset cursor: only entries with an ID greater than this. */
  after?: string | undefined;
  /** Entries per page (the caller bounds it). */
  limit: number;
  /** Only these models (the ones the caller may read); null = every model. */
  modelIds: readonly string[] | null;
  /**
   * A compiled row filter over the `entries` row aliased `e` (content/compiler/policy.ts
   * `compileRowFilter`). It reads the entry as it is now, which for a diff ending at the current snapshot
   * is the state at `to`.
   */
  rowFilter?: RawBuilder<unknown> | null;
};

export type SnapshotDiffPage = { items: SnapshotEntryChange[]; nextAfter: string | null };

export const listChanges = async (
  query: SnapshotDiffQuery,
  executor: Executor = db,
): Promise<SnapshotDiffPage> => {
  if (query.to <= query.from || (query.modelIds !== null && query.modelIds.length === 0)) {
    return { items: [], nextAfter: null };
  }
  const rows = await selectSnapshotDiffRows(
    {
      from: query.from,
      to: query.to,
      after: query.after,
      modelIds: query.modelIds,
      rowFilter: query.rowFilter ?? null,
      maxRows: query.limit + 1,
    },
    executor,
  );
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((row) => ({ entryId: row.entry_id, modelId: row.model_id, locales: row.locales })),
    nextAfter: rows.length > query.limit ? (page.at(-1)?.entry_id ?? null) : null,
  };
};

/**
 * The schema version recorded for each publication sequence number in the `publication_snapshots`
 * ledger; numbers without a ledger row (snapshot 0, rows from before the ledger) are absent.
 */
export const schemaVersionsAt = async (
  seqs: readonly number[],
  executor: Executor = db,
): Promise<Map<number, number | null>> => {
  if (seqs.length === 0) {
    return new Map();
  }
  const rows = await executor
    .selectFrom('publication_snapshots')
    .select(['seq', 'schema_version'])
    .where(
      'seq',
      'in',
      seqs.map((seq) => String(seq)),
    )
    .execute();
  return new Map(rows.map((row) => [Number(row.seq), row.schema_version]));
};

/** When the snapshot `seq` was created, from the ledger (undefined without a ledger row). */
export const snapshotCreatedAt = async (seq: number, executor: Executor = db): Promise<Date | undefined> =>
  (
    await executor
      .selectFrom('publication_snapshots')
      .select('created_at')
      .where('seq', '=', String(seq))
      .executeTakeFirst()
  )?.created_at;
