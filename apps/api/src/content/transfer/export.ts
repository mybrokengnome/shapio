import { PassThrough, type Readable } from 'node:stream';
import type { LockFile } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import { SHAPIO_VERSION } from '../../constants/version.js';
import type { DB } from '../../db/types.js';
import * as adminRolesRepository from '../../repositories/adminRoles.js';
import * as appRolesRepository from '../../repositories/appRoles.js';
import * as localesRepository from '../../repositories/locales.js';
import * as publicationsRepository from '../../repositories/publications.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import * as schemaVersionsRepository from '../../repositories/schemaVersions.js';
import * as transferExportRepository from '../../repositories/transferExport.js';
import type { ExportHeadRow, ExportRevisionRow } from '../../repositories/transferExport.js';
import { toActiveDefinitions } from '../../schema/loadSnapshot.js';
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  type BundleRecord,
  type EntryRecord,
  type ExportOptions,
  type RevisionRecord,
} from './format.js';
import { writeRecord } from './ndjson.js';
import { toGrant } from './permissions.js';

type Executor = Transaction<DB>;

const BATCH_SIZE = 200;

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

/** Revisions with every parent before its children (parents outside the list are dropped as links). */
export const orderParentsFirst = (revisions: readonly ExportRevisionRow[]): RevisionRecord[] => {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const ordered: RevisionRecord[] = [];
  const done = new Set<string>();
  const visit = (revision: ExportRevisionRow) => {
    const stack: ExportRevisionRow[] = [];
    let current: ExportRevisionRow | undefined = revision;
    while (current && !done.has(current.id) && !stack.includes(current)) {
      stack.push(current);
      current = current.parent_revision_id ? byId.get(current.parent_revision_id) : undefined;
    }
    for (const item of stack.reverse()) {
      done.add(item.id);
      ordered.push({
        id: item.id,
        locale: item.locale,
        parentRevisionId:
          item.parent_revision_id && byId.has(item.parent_revision_id) ? item.parent_revision_id : null,
        reason: item.reason as RevisionRecord['reason'],
        data: item.data,
        createdAt: item.created_at.toISOString(),
      });
    }
  };
  revisions.forEach(visit);
  return ordered;
};

const toHead = (head: ExportHeadRow): EntryRecord['heads'][number] => ({
  locale: head.locale,
  state: head.state as 'draft' | 'published',
  revisionId: head.revision_id,
  data: head.data,
  autosavedAt: iso(head.autosaved_at),
  version: head.version,
  createdAt: head.created_at.toISOString(),
  updatedAt: head.updated_at.toISOString(),
  publishedAt: head.state === 'published' ? iso(head.published_at) : null,
});

async function* schemaRecords(trx: Executor): AsyncGenerator<BundleRecord> {
  const schemaVersion = await schemaVersionsRepository.getSchemaVersion(trx);
  // Through the stored-definition reader, so collections saved before plural API IDs carry the derived one.
  const definitions = await toActiveDefinitions(await schemaModelsRepository.findActiveDefinitions(trx));
  const lock: LockFile = { formatVersion: 1, schemaVersion, definitions: {} };
  for (const { definition, version, hash } of definitions) {
    lock.definitions[definition.id] = { kind: definition.kind, apiKey: definition.apiKey, version, hash };
  }
  yield { type: 'schemaLock', lock };
  for (const { definition, version, hash } of definitions) {
    yield {
      type: 'definition',
      definition: definition as unknown as Record<string, unknown>,
      version,
      hash,
    };
  }
}

async function* roleAndUserRecords(
  trx: Executor,
  siteId: string,
  options: ExportOptions,
): AsyncGenerator<BundleRecord> {
  const roles = await appRolesRepository.listRoles(trx);
  const grants = await appRolesRepository.listPermissionsForRoles(
    roles.map((role) => role.id),
    trx,
  );
  for (const role of roles) {
    yield {
      type: 'appRole',
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.is_system,
      permissions: grants.filter((grant) => grant.role_id === role.id).map(toGrant),
    };
  }
  const deliveryRoles = (await adminRolesRepository.listRoles(trx)).filter(
    (role) => role.kind === 'delivery' && !role.is_system,
  );
  const deliveryGrants = await adminRolesRepository.listPermissionsForRoles(
    deliveryRoles.map((role) => role.id),
    trx,
  );
  for (const role of deliveryRoles) {
    yield {
      type: 'deliveryRole',
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: deliveryGrants.filter((grant) => grant.role_id === role.id).map(toGrant),
    };
  }
  if (!options.includeUsers) {
    return;
  }
  for (let after: string | null = null; ;) {
    const users = await transferExportRepository.listAppUsers(siteId, after, BATCH_SIZE, trx);
    if (users.length === 0) {
      break;
    }
    const accounts = await transferExportRepository.listOAuthAccountsForUsers(
      users.map((user) => user.id),
      trx,
    );
    for (const user of users) {
      yield {
        type: 'appUser',
        id: user.id,
        email: user.email,
        name: user.name,
        passwordHash: user.password_hash,
        confirmedAt: iso(user.confirmed_at),
        blockedAt: iso(user.blocked_at),
        passwordChangedAt: iso(user.password_changed_at),
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at.toISOString(),
        roleKeys: user.role_keys,
        oauthAccounts: accounts
          .filter((account) => account.app_user_id === user.id)
          .map((account) => ({
            provider: account.provider,
            providerUserId: account.provider_user_id,
            email: account.email,
          })),
      };
    }
    after = users.at(-1)?.id ?? null;
  }
}

async function* publishingRecords(trx: Executor, siteId: string): AsyncGenerator<BundleRecord> {
  for (const webhook of await transferExportRepository.listWebhooks(siteId, trx)) {
    yield {
      type: 'webhook',
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      enabled: webhook.enabled,
      allowPrivateNetwork: webhook.allow_private_network,
      maxAttempts: webhook.max_attempts,
    };
  }
  for (const connection of await transferExportRepository.listDeploymentConnections(siteId, trx)) {
    yield {
      type: 'deploymentConnection',
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      settings: connection.settings as Record<string, string>,
      secretEnvRefs: connection.secret_env_refs as Record<string, string>,
      previewUrlTemplate: connection.preview_url_template,
      triggerPolicy: connection.trigger_policy,
      debounceSeconds: connection.debounce_seconds,
      allowPrivateNetwork: connection.allow_private_network,
      enabled: connection.enabled,
    };
  }
}

async function* mediaRecords(trx: Executor, siteId: string): AsyncGenerator<BundleRecord> {
  for (const folder of await transferExportRepository.listMediaFolders(siteId, trx)) {
    yield {
      type: 'mediaFolder',
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      createdAt: folder.created_at.toISOString(),
      updatedAt: folder.updated_at.toISOString(),
    };
  }
  for (let after: string | null = null; ;) {
    const assets = await transferExportRepository.listLiveAssets(siteId, after, BATCH_SIZE, trx);
    if (assets.length === 0) {
      break;
    }
    for (const asset of assets) {
      yield {
        type: 'mediaAsset',
        id: asset.id,
        folderId: asset.folder_id,
        filename: asset.original_filename,
        mimeType: asset.mime_type,
        sizeBytes: Number(asset.size_bytes),
        width: asset.width,
        height: asset.height,
        sha256: asset.checksum_sha256,
        alt: asset.alt,
        caption: asset.caption,
        focalX: asset.focal_x,
        focalY: asset.focal_y,
        visibility: asset.visibility as 'public' | 'private',
        storageKey: asset.storage_key,
        createdAt: asset.created_at.toISOString(),
        updatedAt: asset.updated_at.toISOString(),
      };
    }
    after = assets.at(-1)?.id ?? null;
  }
}

async function* entryRecords(
  trx: Executor,
  siteId: string,
  options: ExportOptions,
): AsyncGenerator<EntryRecord> {
  for (let after: string | null = null; ;) {
    const entries = await transferExportRepository.listLiveEntries(siteId, after, BATCH_SIZE, trx);
    if (entries.length === 0) {
      break;
    }
    const ids = entries.map((entry) => entry.id);
    const heads = Map.groupBy(
      await transferExportRepository.listHeadsForEntries(ids, trx),
      (head) => head.entry_id,
    );
    const revisions = Map.groupBy(
      options.headsOnly
        ? await transferExportRepository.listRevisionsByIds(
            [...new Set([...heads.values()].flat().map((head) => head.revision_id))],
            trx,
          )
        : await transferExportRepository.listRevisionsForEntries(ids, trx),
      (revision) => revision.entry_id,
    );
    for (const entry of entries) {
      const entryHeads = heads.get(entry.id) ?? [];
      if (entryHeads.length === 0) {
        continue;
      }
      yield {
        type: 'entry',
        id: entry.id,
        modelId: entry.model_id,
        ownerAppUserId: options.includeUsers ? entry.owner_app_user_id : null,
        createdAt: entry.created_at.toISOString(),
        updatedAt: entry.updated_at.toISOString(),
        revisions: orderParentsFirst(revisions.get(entry.id) ?? []),
        heads: entryHeads.map(toHead),
      };
    }
    after = entries.at(-1)?.id ?? null;
  }
}

/**
 * Every record of one site's bundle, read inside one consistent (REPEATABLE READ) transaction. The schema,
 * locales and roles are shared; content, media, app users, webhooks and connections are the site's.
 */
export async function* bundleRecords(
  trx: Executor,
  siteId: string,
  options: ExportOptions,
): AsyncGenerator<BundleRecord> {
  const counts: Record<string, number> = {};
  const count = (record: BundleRecord) => {
    counts[record.type] = (counts[record.type] ?? 0) + 1;
    if (record.type === 'entry') {
      counts.revision = (counts.revision ?? 0) + record.revisions.length;
    }
    return record;
  };
  yield {
    type: 'header',
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    shapioVersion: SHAPIO_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: await schemaVersionsRepository.getSchemaVersion(trx),
    snapshot: await publicationsRepository.currentSeq(siteId, trx),
    options,
  };
  for (const locale of await localesRepository.list(trx)) {
    yield count({
      type: 'locale',
      code: locale.code,
      label: locale.label,
      isDefault: locale.is_default,
      fallbacks: locale.fallbacks,
    });
  }
  for (const source of [
    schemaRecords(trx),
    roleAndUserRecords(trx, siteId, options),
    publishingRecords(trx, siteId),
    mediaRecords(trx, siteId),
    entryRecords(trx, siteId, options),
  ]) {
    for await (const record of source) {
      yield count(record);
    }
  }
  yield { type: 'end', counts };
}

/**
 * Streams a bundle as NDJSON. The read runs in a REPEATABLE READ, read-only transaction for as long as the
 * reader consumes it; if the reader goes away the transaction ends at the next record. A failure destroys
 * the stream, so the bundle lacks its `end` record and an import refuses it.
 */
export const createExportStream = (
  database: Kysely<DB>,
  siteId: string,
  options: ExportOptions,
  onError: (error: unknown) => void,
): Readable => {
  const output = new PassThrough();
  database
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute(async (trx) => {
      for await (const record of bundleRecords(trx, siteId, options)) {
        await writeRecord(output, record);
      }
    })
    .then(() => output.end())
    .catch((error: unknown) => {
      onError(error);
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  return output;
};
