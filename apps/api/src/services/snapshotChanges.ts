import {
  effectiveLayout,
  effectiveTitleField,
  isModelDefinition,
  routeKeyOf,
  type ModelDefinition,
} from '@shapio/schema';
import type { Transaction } from 'kysely';
import { compileModelRowFilters, maskAllows } from '../content/compiler/policy.js';
import { queryInvalid } from '../content/compiler/types.js';
import { snapshotInvalid } from '../content/errors.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { FieldMask, RowFilter } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import * as snapshotDiffRepository from '../repositories/snapshotDiff.js';
import type { SnapshotChangeKind, SnapshotEntryChange } from '../repositories/snapshotDiff.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * The snapshot diff API (plan developer-face §5): which entries' live content changed between two
 * publication sequence numbers, for incremental site builds. Delivery principals see only models they may
 * read. Row filters (e.g. `ownedByPrincipal`) are evaluated on the entry as it is now, i.e. at `to` when
 * `to` is the current snapshot; an entry the caller may read now but not at `from` (or the reverse) is
 * judged by its state now. The response names entries and locales, never values, so read masks do not
 * apply: an entry whose only change is in a field the caller cannot read is still listed as `updated`.
 *
 * Old snapshots are diffed as recorded. When the schema version differs between the two ends, clients
 * should rebuild the affected models rather than trust per-entry changes (fields may have been added,
 * converted or removed without new publications); locale deletion rewrites history.
 */
export const SNAPSHOT_CHANGES_DEFAULT_LIMIT = 100;
export const SNAPSHOT_CHANGES_MAX_LIMIT = 500;

export type SnapshotChangeView = {
  id: string;
  modelId: string;
  /** The model's API ID (GraphQL, admin API). */
  modelKey: string;
  /** The model's delivery route key (`/api/content/<routeKey>`). */
  routeKey: string;
  /**
   * The entry's title from its revision live at `to` (at `from` when it was unpublished), in the default
   * locale when that changed, else the first changed locale; null without a title field, a readable one
   * or a value.
   */
  title: string | null;
  /** The cover image's media asset ID from the same revision, when the model has a readable cover. */
  coverMediaId: string | null;
  locales: Array<{
    locale: string;
    change: SnapshotChangeKind;
    /** The revision live at `to`, or the one live at `from` for `unpublished` (open it in the admin). */
    revisionId: string | null;
  }>;
};

export type SnapshotChangesPage = {
  from: number;
  to: number;
  /** The schema version recorded with each end's snapshot; null when none was recorded. */
  schemaVersions: { from: number | null; to: number | null };
  items: SnapshotChangeView[];
  /** Pass as `after` for the next page; null on the last page. */
  nextCursor: string | null;
};

export type SnapshotChangesQuery = { from: number; to?: number; after?: string; limit?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReadableModel = { definition: ModelDefinition; rowFilter: RowFilter | null; readMask: FieldMask };

/**
 * Models the caller may read. An authenticated caller (session, token, app user) with none (or an instance
 * with no models yet) gets empty results, never an error. Anonymous callers with nothing readable get 401,
 * as the delivery routes answer them when the `public` role grants nothing.
 */
const readableModels = async (context: ContentServiceContext): Promise<ReadableModel[]> => {
  const models = context.snapshot.definitions
    .map((active) => active.definition)
    .filter((definition): definition is ModelDefinition => isModelDefinition(definition));
  const readable: ReadableModel[] = [];
  for (const definition of models) {
    const policy = await context.permissions.evaluate(context.actor, {
      action: 'read',
      modelId: definition.id,
    });
    if (policy.allowed) {
      readable.push({ definition, rowFilter: policy.rowFilter, readMask: policy.readMask });
    }
  }
  if (readable.length === 0 && context.actor.kind === 'anonymous') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Snapshots need a delivery token');
  }
  return readable;
};

type Describe = (item: SnapshotEntryChange) => { title: string | null; coverMediaId: string | null };

/** The revision an entry is described from: the default locale's when it changed, else the first. */
const revisionOf = (item: SnapshotEntryChange, defaultLocale: string): string | null => {
  const locale = item.locales.find((candidate) => candidate.locale === defaultLocale) ?? item.locales[0];
  return locale ? (locale.toRevisionId ?? locale.fromRevisionId) : null;
};

/**
 * Title and cover per changed entry, read from one revision each (one query for the page). Fields the
 * caller's read mask hides are left out.
 */
const describeEntries = async (
  items: readonly SnapshotEntryChange[],
  models: ReadonlyMap<string, ReadableModel>,
  defaultLocale: string,
  executor: Transaction<DB>,
): Promise<Describe> => {
  const revisionIds = [...new Set(items.flatMap((item) => revisionOf(item, defaultLocale) ?? []))];
  const rows = await contentRevisionsRepository.findDataByIds(revisionIds, executor);
  const dataById = new Map(rows.map((row) => [row.id, row.data as Record<string, unknown>]));
  return (item) => {
    const model = models.get(item.modelId);
    const revisionId = revisionOf(item, defaultLocale);
    const data = revisionId ? dataById.get(revisionId) : undefined;
    if (!model || !data) {
      return { title: null, coverMediaId: null };
    }
    const titleField = effectiveTitleField(model.definition);
    const cover = effectiveLayout(model.definition).cover;
    const title = titleField && maskAllows(model.readMask, titleField) ? data[titleField.id] : undefined;
    const coverId = cover && maskAllows(model.readMask, cover) ? data[cover.id] : undefined;
    return {
      title:
        typeof title === 'string' && title.trim() !== ''
          ? title
          : typeof title === 'number'
            ? String(title)
            : null,
      coverMediaId: typeof coverId === 'string' ? coverId : null,
    };
  };
};

const boundedLimit = (limit: number | undefined) =>
  Math.min(Math.max(limit ?? SNAPSHOT_CHANGES_DEFAULT_LIMIT, 1), SNAPSHOT_CHANGES_MAX_LIMIT);

/** `GET /api/snapshots/changes`, GraphQL `_changes`: one page of entries changed between `from` and `to`. */
export const listSnapshotChanges = async (
  context: ContentServiceContext,
  query: SnapshotChangesQuery,
): Promise<SnapshotChangesPage> => {
  if (query.after !== undefined && !UUID.test(query.after)) {
    throw queryInvalid('"after" must be a cursor returned by a previous page');
  }
  const readable = await readableModels(context);
  const byId = new Map(readable.map((model) => [model.definition.id, model]));
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const current = await publicationsRepository.currentSeq(context.site.id, trx);
    const to = query.to ?? current;
    if (to > current) {
      throw snapshotInvalid(to, current);
    }
    if (query.from < 0 || query.from > to) {
      throw queryInvalid('"from" must be between 0 and "to"');
    }
    const page = await snapshotDiffRepository.listChanges(
      {
        siteId: context.site.id,
        from: query.from,
        to,
        after: query.after,
        limit: boundedLimit(query.limit),
        modelIds: [...byId.keys()],
        rowFilter: compileModelRowFilters(
          readable.map((model) => ({ modelId: model.definition.id, rowFilter: model.rowFilter })),
          context.actor,
        ),
      },
      trx,
    );
    const versions = await snapshotDiffRepository.schemaVersionsAt(context.site.id, [query.from, to], trx);
    const describe = await describeEntries(page.items, byId, context.snapshot.defaultLocale, trx);
    return {
      from: query.from,
      to,
      schemaVersions: { from: versions.get(query.from) ?? null, to: versions.get(to) ?? null },
      items: page.items.flatMap((item) => {
        const model = byId.get(item.modelId)?.definition;
        return model
          ? [
              {
                id: item.entryId,
                modelId: item.modelId,
                modelKey: model.apiKey,
                routeKey: routeKeyOf(model),
                ...describe(item),
                locales: item.locales.map(({ locale, change, fromRevisionId, toRevisionId }) => ({
                  locale,
                  change,
                  revisionId: toRevisionId ?? fromRevisionId,
                })),
              },
            ]
          : [];
      }),
      nextCursor: page.nextAfter,
    };
  }, context.db);
};

export type CurrentSnapshot = {
  /** The latest publication sequence number (what an unpinned read serves). */
  snapshot: number;
  /** The active schema version (`system_versions`; what delivery serves now). */
  schemaVersion: number;
  /** When the latest snapshot was published; null when the ledger has no row for it (snapshot 0). */
  publishedAt: Date | null;
};

/** `GET /api/snapshots/current`, GraphQL `_snapshot`. */
export const currentSnapshot = async (context: ContentServiceContext): Promise<CurrentSnapshot> => {
  await readableModels(context);
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const snapshot = await publicationsRepository.currentSeq(context.site.id, trx);
    const publishedAt = await snapshotDiffRepository.snapshotCreatedAt(context.site.id, snapshot, trx);
    // The active version (system_versions), read in the same moment as the sequence. Not the ledger's:
    // metadata-only activations (a label rename) take no snapshot number, so the newest ledger row can
    // carry an older schema version than the live one.
    const schemaVersion = await schemaVersionsRepository.getSchemaVersion(trx);
    return { snapshot, schemaVersion, publishedAt: publishedAt ?? null };
  }, context.db);
};
