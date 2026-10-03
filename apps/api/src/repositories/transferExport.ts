import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { emptyArray, sortedArrayAgg } from '../db/sql/values.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Reads behind `GET /api/admin/transfer/export` (content export, package L). The export runs them all in one
 * REPEATABLE READ transaction, so the bundle is one consistent moment. Lists are keyset-paged by ID.
 */

/**
 * One site's live entries after `afterId` (keyset), oldest model order irrelevant: IDs are the stable order.
 * A bundle is one site's content (sites plan §H: `--site`).
 */
export const listLiveEntries = (
  siteId: string,
  afterId: string | null,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('entries')
    .select(['id', 'model_id', 'owner_app_user_id', 'created_at', 'updated_at'])
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();

export type ExportEntryRow = Awaited<ReturnType<typeof listLiveEntries>>[number];

/** Every head of these entries, with the open publication period of published heads (its `published_at`). */
export const listHeadsForEntries = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entry_heads as h')
        .leftJoin('publication_log as pl', (join) =>
          join
            .onRef('pl.entry_id', '=', 'h.entry_id')
            .onRef('pl.locale', '=', 'h.locale')
            .on('h.state', '=', 'published')
            .on('pl.to_seq', 'is', null),
        )
        .select([
          'h.entry_id',
          'h.locale',
          'h.state',
          'h.revision_id',
          'h.data',
          'h.autosaved_at',
          'h.version',
          'h.created_at',
          'h.updated_at',
          'pl.published_at',
        ])
        .where('h.entry_id', 'in', entryIds)
        .orderBy('h.entry_id')
        .orderBy('h.locale')
        .orderBy('h.state')
        .execute();

export type ExportHeadRow = Awaited<ReturnType<typeof listHeadsForEntries>>[number];

const REVISION_COLUMNS = [
  'id',
  'entry_id',
  'locale',
  'parent_revision_id',
  'reason',
  'data',
  'author_type',
  'created_at',
] as const;

/** Every revision of these entries (full history). */
export const listRevisionsForEntries = (entryIds: readonly string[], executor: Executor = db) =>
  entryIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('content_revisions')
        .select(REVISION_COLUMNS)
        .where('entry_id', 'in', entryIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute();

export type ExportRevisionRow = Awaited<ReturnType<typeof listRevisionsForEntries>>[number];

/** Only these revisions (heads-only exports: the revisions heads point at). */
export const listRevisionsByIds = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('content_revisions')
        .select(REVISION_COLUMNS)
        .where('id', 'in', ids)
        .orderBy('created_at')
        .orderBy('id')
        .execute();

/** Every media folder of one site (a small tree). */
export const listMediaFolders = (siteId: string, executor: Executor = db) =>
  executor
    .selectFrom('media_folders')
    .select(['id', 'parent_id', 'name', 'created_at', 'updated_at'])
    .where('site_id', '=', siteId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

const ASSET_COLUMNS = [
  'id',
  'folder_id',
  'original_filename',
  'mime_type',
  'size_bytes',
  'width',
  'height',
  'checksum_sha256',
  'alt',
  'caption',
  'focal_x',
  'focal_y',
  'visibility',
  'status',
  'storage_driver',
  'storage_key',
  'created_at',
  'updated_at',
] as const;

/** One site's live media assets after `afterId` (keyset). */
export const listLiveAssets = (
  siteId: string,
  afterId: string | null,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('media_assets')
    .select(ASSET_COLUMNS)
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();

export type ExportAssetRow = Awaited<ReturnType<typeof listLiveAssets>>[number];

/** One site's live app users after `afterId` (keyset), with their password hash and custom role keys. */
export const listAppUsers = (
  siteId: string,
  afterId: string | null,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('app_users')
    .select([
      'id',
      'email',
      'name',
      'password_hash',
      'confirmed_at',
      'blocked_at',
      'password_changed_at',
      'created_at',
      'updated_at',
    ])
    .select((eb) => [
      eb.fn
        .coalesce(
          eb
            .selectFrom('app_user_roles')
            .innerJoin('app_roles', 'app_roles.id', 'app_user_roles.role_id')
            .select(sortedArrayAgg<string>('app_roles.key').as('keys'))
            .whereRef('app_user_roles.app_user_id', '=', 'app_users.id'),
          emptyArray<string>('text'),
        )
        .as('role_keys'),
    ])
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();

export type ExportAppUserRow = Awaited<ReturnType<typeof listAppUsers>>[number];

export const listOAuthAccountsForUsers = (userIds: readonly string[], executor: Executor = db) =>
  userIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('app_oauth_accounts')
        .select(['app_user_id', 'provider', 'provider_user_id', 'email'])
        .where('app_user_id', 'in', userIds)
        .orderBy('provider')
        .execute();

/** One site's own webhooks without their secret (network webhooks are not a site's configuration). */
export const listWebhooks = (siteId: string, executor: Executor = db) =>
  executor
    .selectFrom('webhooks')
    .select(['id', 'name', 'url', 'events', 'enabled', 'allow_private_network', 'max_attempts'])
    .where('site_id', '=', siteId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

/**
 * One site's deployment connections without their encrypted secrets (environment references are names, not
 * secrets).
 */
export const listDeploymentConnections = (siteId: string, executor: Executor = db) =>
  executor
    .selectFrom('deployment_connections')
    .where('site_id', '=', siteId)
    .select([
      'id',
      'name',
      'provider',
      'settings',
      'secret_env_refs',
      'preview_url_template',
      'trigger_policy',
      'debounce_seconds',
      'allow_private_network',
      'enabled',
    ])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
