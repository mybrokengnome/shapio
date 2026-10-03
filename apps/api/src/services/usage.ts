import type { FieldDefinition } from '@shapio/schema';
import { modelNotFound, resolveModelById } from '../content/model.js';
import type { Database } from '../db/index.js';
import * as usageRepository from '../repositories/usage.js';
import type { FieldUsageRow, UsageSelection } from '../repositories/usage.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { UsageBatch } from '../usage/aggregator.js';
import { usageDayOf } from '../usage/keys.js';
import type { SiteRef } from './actorContext.js';

/**
 * Field usage from delivery traffic (plan developer-face §5): who reads which fields, from the daily
 * counters the usage aggregator flushes. Used by the usage API and by change-set reviews (the consumers
 * of fields a breaking change affects).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The usage API's window when `days` is not given. */
export const DEFAULT_USAGE_DAYS = 7;

/** The first day (UTC, inclusive) of a window of `days` days ending today. */
export const windowStartDay = (days: number, now: Date = new Date()): string =>
  usageDayOf(new Date(now.getTime() - (Math.max(days, 1) - 1) * DAY_MS));

export type FieldPrincipalUsage = {
  /** The site the reads were made on (a token is on one site; anonymous readers are counted per site). */
  site: SiteRef;
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  /** The API token's name (tokens only, while the token exists). */
  tokenName?: string;
  reads: number;
  lastReadAt: Date;
  /** `explicit` when any of these reads selected the field; `implicit` when all asked for the whole model. */
  selection: UsageSelection;
};

/** Readers on sites the viewer may not see in detail: how many, and how many reads. */
export type OtherSitesUsage = { consumers: number; reads: number };

export type FieldConsumers = {
  fieldId: string;
  principals: FieldPrincipalUsage[];
  /** Null when the viewer sees every site; otherwise the anonymous totals of the other sites. */
  otherSites: OtherSitesUsage | null;
};

/**
 * Sums rows per (site, principal); `explicit` wins over `implicit` (the reader named the field at least
 * once).
 */
const byPrincipal = (rows: readonly FieldUsageRow[]): FieldPrincipalUsage[] => {
  const merged = new Map<string, FieldPrincipalUsage>();
  for (const row of rows) {
    const key = `${row.siteId}\u0000${row.principalKey}`;
    const known = merged.get(key);
    if (!known) {
      merged.set(key, {
        site: { id: row.siteId, key: row.siteKey },
        principalKey: row.principalKey,
        ...(row.tokenName !== null ? { tokenName: row.tokenName } : {}),
        reads: row.reads,
        lastReadAt: row.lastReadAt,
        selection: row.selection,
      });
      continue;
    }
    known.reads += row.reads;
    known.lastReadAt = row.lastReadAt > known.lastReadAt ? row.lastReadAt : known.lastReadAt;
    known.selection =
      known.selection === 'explicit' || row.selection === 'explicit' ? 'explicit' : 'implicit';
  }
  return [...merged.values()].sort((a, b) => b.reads - a.reads);
};

const pathInvolves = (fieldPath: string, fieldId: string) => fieldPath.split('.').includes(fieldId);

/**
 * Which sites' readers a viewer sees in detail (sites plan §H): every site for a network viewer (roles on
 * every site, or a network token), otherwise their own site, with the other sites as anonymous totals.
 */
export type ConsumersView = { siteId: string; network: boolean };

const otherSitesOf = (principals: readonly FieldPrincipalUsage[]): OtherSitesUsage => ({
  consumers: principals.length,
  reads: principals.reduce((sum, principal) => sum + principal.reads, 0),
});

/**
 * Who read each of `fieldIds` in the last `days` days (today included), most reads first, on every site (the
 * schema is shared, so a breaking change affects every site's readers). A field counts as read when it was
 * read directly, as a populated relation's target field, or as a relation whose targets were read through.
 * Every requested field is in the result, with no principals when unread.
 */
export const consumersOf = async (
  fieldIds: readonly string[],
  days: number,
  view: ConsumersView,
): Promise<FieldConsumers[]> => {
  const rows = await usageRepository.fieldUsageForFields(fieldIds, windowStartDay(days));
  return fieldIds.map((fieldId) => {
    const principals = byPrincipal(rows.filter((row) => pathInvolves(row.fieldPath, fieldId)));
    if (view.network) {
      return { fieldId, principals, otherSites: null };
    }
    return {
      fieldId,
      principals: principals.filter((principal) => principal.site.id === view.siteId),
      otherSites: otherSitesOf(principals.filter((principal) => principal.site.id !== view.siteId)),
    };
  });
};

export type ModelFieldUsage = {
  fieldPath: string;
  /** API keys along the path in the current schema (`author.name`); null when a field no longer exists. */
  apiKeyPath: string | null;
  reads: number;
  lastReadAt: Date;
  principals: FieldPrincipalUsage[];
};

export type PrincipalUsageSummary = {
  principalKey: string;
  tokenName?: string;
  requests: number;
  lastReadAt: Date;
  /** The snapshot this principal last pinned with `snapshot`; null when it reads the live content. */
  lastSnapshot: number | null;
};

export type ModelUsage = {
  modelId: string;
  days: number;
  /** First day counted (UTC, inclusive). */
  since: string;
  fields: ModelFieldUsage[];
  /** The principals that read this model's fields, with their request totals (all models) and pins. */
  principals: PrincipalUsageSummary[];
};

const fieldsOf = (snapshot: SchemaSnapshot, modelId: string): readonly FieldDefinition[] =>
  resolveModelById(snapshot, modelId)?.definition.fields ?? [];

/** `relId.subId` → `author.name` through the current schema; null if any step no longer exists. */
const apiKeyPathOf = (snapshot: SchemaSnapshot, modelId: string, fieldPath: string): string | null => {
  const [first, second] = fieldPath.split('.');
  const field = fieldsOf(snapshot, modelId).find((candidate) => candidate.id === first);
  if (!field) {
    return null;
  }
  if (second === undefined) {
    return field.apiKey;
  }
  const targetId = field.type === 'relation' ? field.settings.target : undefined;
  const target = targetId
    ? fieldsOf(snapshot, targetId).find((candidate) => candidate.id === second)
    : undefined;
  return target ? `${field.apiKey}.${target.apiKey}` : null;
};

/**
 * `GET /api/admin/usage/fields`: per field of one model, reads by principal on the request's site, plus
 * per-principal totals there.
 */
export const modelUsage = async (
  snapshot: SchemaSnapshot,
  site: SiteRef,
  modelId: string,
  days: number,
): Promise<ModelUsage> => {
  if (!resolveModelById(snapshot, modelId)) {
    throw modelNotFound(modelId);
  }
  const since = windowStartDay(days);
  const rows = await usageRepository.fieldUsageForModel(site.id, modelId, since);
  const paths = [...new Set(rows.map((row) => row.fieldPath))];
  const fields = paths
    .map((fieldPath) => {
      const principals = byPrincipal(rows.filter((row) => row.fieldPath === fieldPath));
      return {
        fieldPath,
        apiKeyPath: apiKeyPathOf(snapshot, modelId, fieldPath),
        reads: principals.reduce((sum, principal) => sum + principal.reads, 0),
        lastReadAt: new Date(Math.max(...principals.map((principal) => principal.lastReadAt.getTime()))),
        principals,
      };
    })
    .sort((a, b) => b.reads - a.reads);
  const readers = new Set(rows.map((row) => row.principalKey));
  const principals = (await usageRepository.principalSummaries(site.id, since))
    .filter((summary) => readers.has(summary.principalKey))
    .map(({ tokenName, ...summary }) => ({ ...summary, ...(tokenName !== null ? { tokenName } : {}) }));
  return { modelId, days, since, fields, principals };
};

/** Rows per upsert statement: 7 parameters per row stays well under PostgreSQL's 65,535 per statement. */
const UPSERT_CHUNK = 5000;

const chunks = <T>(rows: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
    out.push(rows.slice(index, index + UPSERT_CHUNK));
  }
  return out;
};

const byKey =
  <T>(key: (row: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/**
 * Writes one aggregator flush in one transaction: multi-row upserts, chunked only past UPSERT_CHUNK rows.
 * Rows go in key order, so two instances flushing overlapping keys lock them in the same order (no deadlock).
 */
export const writeUsageBatch = (database: Database, batch: UsageBatch): Promise<void> =>
  database.transaction().execute(async (trx) => {
    const fieldReads = [...batch.fieldReads].sort(
      byKey((row) =>
        [row.day, row.siteId, row.modelId, row.fieldPath, row.principalKey, row.selection].join('\u0000'),
      ),
    );
    const tokenReads = [...batch.tokenReads].sort(
      byKey((row) => [row.day, row.siteId, row.principalKey].join('\u0000')),
    );
    for (const rows of chunks(fieldReads)) {
      await usageRepository.upsertFieldReads(rows, trx);
    }
    for (const rows of chunks(tokenReads)) {
      await usageRepository.upsertTokenReads(rows, trx);
    }
  });
