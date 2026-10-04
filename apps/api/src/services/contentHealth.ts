import type { Kysely, Transaction } from 'kysely';
import { imageUsesOf } from '../content/health/imageUses.js';
import {
  evaluateHealth,
  type AssetInfo,
  type EdgeInfo,
  type Finding,
  type HeadSnapshot,
} from '../content/health/rules.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import { findPublishedUniqueConflicts } from '../content/unique.js';
import { buildValidator } from '../content/validator/index.js';
import type { ContentIssue } from '../content/validator/issues.js';
import type { DB } from '../db/types.js';
import * as contentHealthFindingsRepository from '../repositories/contentHealthFindings.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as relationEdgesRepository from '../repositories/relationEdges.js';
import type { SchemaById } from '../schema/snapshot.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** What evaluating health needs: no HTTP objects, usable from requests and jobs alike. */
export type HealthEnvironment = {
  db: Kysely<DB>;
  snapshot: SchemaById;
  /** HEALTH_STALE_DAYS. */
  staleDays: number;
  now?: () => Date;
};

const toSnapshot = (head: HeadRecord): HeadSnapshot => ({
  locale: head.locale,
  data: head.data,
  revisionId: head.revision_id,
  updatedAt: head.updated_at,
  autosavedAt: head.autosaved_at,
});

/** The images the drafts use, from the entry's own site's library (media is per site; sites plan §H). */
const loadAssets = async (
  executor: Executor,
  model: ContentModel,
  drafts: readonly HeadSnapshot[],
  siteId: string | undefined,
): Promise<Map<string, AssetInfo>> => {
  const ids = [
    ...new Set(drafts.flatMap((draft) => imageUsesOf(model, draft.data).map((use) => use.assetId))),
  ];
  if (siteId === undefined || ids.length === 0) {
    return new Map();
  }
  const rows = await mediaAssetsRepository.findAltOnSite(siteId, ids, executor);
  return new Map(rows.map((row) => [row.id, { alt: row.alt, mimeType: row.mime_type }]));
};

/** The draft heads' relation edges, with each target's state (deleted, published locales, its model). */
const loadEdges = async (executor: Executor, snapshot: SchemaById, entryId: string): Promise<EdgeInfo[]> => {
  const edges = await relationEdgesRepository.listForEntryState(entryId, 'draft', executor);
  const targetIds = [...new Set(edges.map((edge) => edge.target_entry_id))];
  const [targets, published] = await Promise.all([
    entriesRepository.findByIds(targetIds, executor),
    entryHeadsRepository.findPublishedLocales(targetIds, executor),
  ]);
  const live = new Map(targets.filter((row) => row.deleted_at === null).map((row) => [row.id, row]));
  return edges.map((edge) => {
    const target = live.get(edge.target_entry_id);
    const definition = target ? resolveModelById(snapshot, target.model_id)?.definition : undefined;
    return {
      locale: edge.locale,
      fieldId: edge.field_id,
      targetEntryId: edge.target_entry_id,
      ...(target && definition
        ? {
            target: {
              modelId: target.model_id,
              publishedLocales: published
                .filter((row) => row.entry_id === target.id)
                .map((row) => row.locale),
              alwaysLive: !definition.draftAndPublish,
              localized: definition.localized,
            },
          }
        : {}),
    };
  });
};

/** Every health finding of one entry, from its current heads (read-only). */
export const computeEntryHealth = async (
  env: HealthEnvironment,
  model: ContentModel,
  entryId: string,
  heads: readonly HeadRecord[],
  executor: Executor = env.db,
): Promise<Finding[]> => {
  const drafts = heads.filter((head) => head.state === 'draft').map(toSnapshot);
  const published = heads.filter((head) => head.state === 'published').map(toSnapshot);
  const validator = buildValidator(env.snapshot, model);
  const issuesByLocale = new Map<string, readonly ContentIssue[]>(
    drafts.map((draft) => [draft.locale, validator.validate(draft.data).issues]),
  );
  const [assets, edges, uniqueConflicts] = await Promise.all([
    loadAssets(executor, model, drafts, heads[0]?.site_id),
    loadEdges(executor, env.snapshot, entryId),
    model.definition.draftAndPublish
      ? findPublishedUniqueConflicts(executor, { entryId, model: model.definition, drafts })
      : Promise.resolve([]),
  ]);
  return evaluateHealth({
    model,
    locales: env.snapshot.locales.map((locale) => locale.code),
    drafts,
    published,
    issuesByLocale,
    assets,
    edges,
    uniqueConflicts,
    now: (env.now ?? (() => new Date()))(),
    staleDays: env.staleDays,
  });
};

/** Records an evaluation: present findings are upserted, the others resolved, in one transaction. */
export const recordEntryHealth = (
  env: HealthEnvironment,
  entry: { entryId: string; modelId: string },
  findings: readonly Finding[],
) =>
  env.db.transaction().execute((trx) =>
    contentHealthFindingsRepository.replaceForEntry(
      entry,
      findings.map((finding) => ({
        locale: finding.locale,
        rule: finding.rule,
        subject: finding.subject,
        severity: finding.severity,
        path: finding.path ?? null,
        details: finding.params,
      })),
      (env.now ?? (() => new Date()))(),
      trx,
    ),
  );

/**
 * Re-evaluates an entry and records the outcome. A deleted entry, or one whose model is gone, has its
 * findings resolved. Returns the findings (empty for those).
 */
export const evaluateEntry = async (env: HealthEnvironment, entryId: string): Promise<Finding[]> => {
  const [entry] = await entriesRepository.findByIds([entryId], env.db);
  const model = entry ? resolveModelById(env.snapshot, entry.model_id) : undefined;
  if (!entry || entry.deleted_at !== null || !model) {
    await contentHealthFindingsRepository.resolveForEntry(entryId, (env.now ?? (() => new Date()))(), env.db);
    return [];
  }
  const heads = await entryHeadsRepository.findForEntry(entryId, env.db);
  const findings = await computeEntryHealth(env, model, entryId, heads);
  await recordEntryHealth(env, { entryId, modelId: model.definition.id }, findings);
  return findings;
};

export type SweepPage = { after: string | null; limit: number; modelIds?: readonly string[] };

/** Evaluates one page of live entries in ID order; returns the last ID for the next page (null when done). */
export const sweepPage = async (
  env: HealthEnvironment,
  page: SweepPage,
  signal?: AbortSignal,
): Promise<{ evaluated: number; next: string | null }> => {
  const rows = await entriesRepository.listLiveIdsAfter(page, env.db);
  let evaluated = 0;
  for (const row of rows) {
    if (signal?.aborted) {
      return { evaluated, next: rows[evaluated - 1]?.id ?? page.after };
    }
    await evaluateEntry(env, row.id);
    evaluated += 1;
  }
  return { evaluated, next: rows.length < page.limit ? null : (rows.at(-1)?.id ?? null) };
};
