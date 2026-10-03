import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { entrySiteOf } from './entries.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type FindingWrite = {
  locale: string;
  rule: string;
  subject: string;
  severity: string;
  path: string | null;
  details: Record<string, unknown>;
};

/**
 * Records one evaluation of an entry in its transaction: upserts what was found (keeping `first_seen_at`,
 * reopening a resolved finding) and resolves open findings that were not found again.
 */
export const replaceForEntry = async (
  entry: { entryId: string; modelId: string },
  findings: readonly FindingWrite[],
  now: Date,
  trx: Transaction<DB>,
) => {
  if (findings.length > 0) {
    await trx
      .insertInto('content_health_findings')
      .values(
        findings.map((finding) => ({
          entry_id: entry.entryId,
          site_id: entrySiteOf(trx, entry.entryId),
          model_id: entry.modelId,
          locale: finding.locale,
          rule: finding.rule,
          subject: finding.subject,
          severity: finding.severity,
          path: finding.path,
          details: JSON.stringify(finding.details),
          first_seen_at: now,
          last_seen_at: now,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['entry_id', 'locale', 'rule', 'subject']).doUpdateSet((eb) => ({
          model_id: eb.ref('excluded.model_id'),
          severity: eb.ref('excluded.severity'),
          path: eb.ref('excluded.path'),
          details: eb.ref('excluded.details'),
          last_seen_at: eb.ref('excluded.last_seen_at'),
          first_seen_at: eb
            .case()
            .when('content_health_findings.resolved_at', 'is not', null)
            .then(eb.ref('excluded.first_seen_at'))
            .else(eb.ref('content_health_findings.first_seen_at'))
            .end(),
          resolved_at: null,
        })),
      )
      .execute();
  }
  await trx
    .updateTable('content_health_findings')
    .set({ resolved_at: now })
    .where('entry_id', '=', entry.entryId)
    .where('resolved_at', 'is', null)
    .where('last_seen_at', '<', now)
    .execute();
};

/** Resolves every open finding of an entry (it was deleted). */
export const resolveForEntry = (entryId: string, now: Date, executor: Executor = db) =>
  executor
    .updateTable('content_health_findings')
    .set({ resolved_at: now })
    .where('entry_id', '=', entryId)
    .where('resolved_at', 'is', null)
    .execute();

export type OpenFindingsQuery = {
  /** Findings are per site (sites plan §H). */
  siteId: string;
  modelIds: readonly string[];
  rule?: string;
  /** Keyset: findings after this (last_seen_at, id) in newest-first order. */
  after?: { lastSeenAt: Date; id: string };
  limit: number;
};

/** Open findings of live entries of the given models, newest first, with the entry's ownership columns. */
export const listOpen = (query: OpenFindingsQuery, executor: Executor = db) => {
  if (query.modelIds.length === 0) {
    return Promise.resolve([]);
  }
  let select = executor
    .selectFrom('content_health_findings as f')
    .innerJoin('entries as e', 'e.id', 'f.entry_id')
    .select([
      'f.id',
      'f.entry_id',
      'f.model_id',
      'f.locale',
      'f.rule',
      'f.subject',
      'f.severity',
      'f.path',
      'f.details',
      'f.first_seen_at',
      'f.last_seen_at',
      'e.owner_app_user_id',
      'e.created_by_admin_id',
    ])
    .where('f.site_id', '=', query.siteId)
    .where('f.resolved_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .where('f.model_id', 'in', query.modelIds)
    .orderBy('f.last_seen_at', 'desc')
    .orderBy('f.id', 'desc')
    .limit(query.limit);
  if (query.rule) {
    select = select.where('f.rule', '=', query.rule);
  }
  if (query.after) {
    const { lastSeenAt, id } = query.after;
    select = select.where((eb) =>
      eb.or([
        eb('f.last_seen_at', '<', lastSeenAt),
        eb.and([eb('f.last_seen_at', '=', lastSeenAt), eb('f.id', '<', id)]),
      ]),
    );
  }
  return select.execute();
};

export type OpenFindingRow = Awaited<ReturnType<typeof listOpen>>[number];

/** Open findings of one entry (the pre-flight reads what it just recorded). */
export const listOpenForEntry = (entryId: string, executor: Executor = db) =>
  executor
    .selectFrom('content_health_findings')
    .select(['locale', 'rule', 'subject', 'severity', 'path', 'details'])
    .where('entry_id', '=', entryId)
    .where('resolved_at', 'is', null)
    .execute();

/** Open findings per rule and model of one site, for live entries (the Inbox's groups). */
export const countOpenByRule = (siteId: string, modelIds: readonly string[], executor: Executor = db) =>
  modelIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('content_health_findings as f')
        .innerJoin('entries as e', 'e.id', 'f.entry_id')
        .select(['f.rule', 'f.model_id', ({ fn }) => fn.countAll<string>().as('count')])
        .where('f.site_id', '=', siteId)
        .where('f.resolved_at', 'is', null)
        .where('e.deleted_at', 'is', null)
        .where('f.model_id', 'in', modelIds)
        .groupBy(['f.rule', 'f.model_id'])
        .execute();
