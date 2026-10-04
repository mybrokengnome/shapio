import type { Readable } from 'node:stream';
import { LOCK_FILE_FORMAT_VERSION, type LockFile, type SchemaChange } from '@shapio/schema';
import { AppError } from '../../helpers/appError.js';
import * as adminRolesRepository from '../../repositories/adminRoles.js';
import * as appRolesRepository from '../../repositories/appRoles.js';
import * as deploymentConnectionsRepository from '../../repositories/deploymentConnections.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import * as webhooksRepository from '../../repositories/webhooks.js';
import type { SchemaServiceContext } from '../../services/schemaAccess.js';
import { applySchema, type SyncResultItem } from '../../services/schemaSync.js';
import { classifyEntry, type EntryClassification } from './classify.js';
import type {
  AppRoleRecord,
  AppUserRecord,
  ConnectionRecord,
  DeliveryRoleRecord,
  DefinitionRecord,
  EntryRecord,
  HeaderRecord,
  LocaleRecord,
  MediaAssetRecord,
  MediaFolderRecord,
  WebhookRecord,
} from './format.js';
import { readBundle } from './ndjson.js';
import { samePermissions } from './permissions.js';

/**
 * The import plan (package L): a dry run that reads the whole bundle once and compares it with the target
 * by stable ID. `shapio import --dry-run` prints it; a real import computes it again and refuses when it has
 * conflicts, exactly like a rejected `schema apply`.
 */
export const EMPTY_LOCK: LockFile = {
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: 0,
  definitions: {},
};

/** How many IDs or conflicts a plan lists per category (counts are always complete). */
export const LIST_LIMIT = 100;
const BATCH = 200;

export type ImportOptions = { prune: boolean };

export type SchemaItem = {
  id: string;
  apiKey: string;
  kind: string;
  changes?: SchemaChange[];
  reason?: string;
};

export type Conflict = { id: string; model?: string; reason: string; detail?: string };

export type MediaFileNeed = {
  assetId: string;
  storageKey: string;
  sha256: string | null;
  sizeBytes: number;
  mimeType: string;
};

type Counted = { added: number; updated: number; unchanged: number };

export type ImportDiff = {
  bundle: Pick<HeaderRecord, 'exportedAt' | 'shapioVersion' | 'schemaVersion' | 'snapshot' | 'options'>;
  locales: {
    added: string[];
    changed: string[];
    unchanged: string[];
    /** The bundle's default locale when it differs from the target's (applied only to a target without content). */
    defaultLocale: { from: string; to: string; blocked: boolean } | null;
  };
  schema: { added: SchemaItem[]; unchanged: SchemaItem[]; conflicts: SchemaItem[] };
  appRoles: { added: string[]; updated: string[]; unchanged: string[] };
  /** Custom delivery roles by key (tokens never travel: create new ones on the target). */
  deliveryRoles: { added: string[]; updated: string[]; unchanged: string[]; conflicts: string[] };
  appUsers: { added: number; unchanged: number; conflicts: Conflict[]; conflictCount: number };
  webhooks: { added: string[]; unchanged: string[] };
  deploymentConnections: { added: string[]; unchanged: string[]; needSecrets: string[] };
  media: {
    folders: { added: number; unchanged: number };
    added: number;
    unchanged: number;
    conflicts: Conflict[];
    conflictCount: number;
    /** Files the target needs for the added assets (uploaded by `shapio import` from a `--with-media` bundle). */
    files: MediaFileNeed[];
  };
  entries: Counted & {
    conflicts: Conflict[];
    conflictCount: number;
    byModel: Record<string, Counted & { conflicts: number }>;
  };
  prune: { entries: number; assets: number } | null;
  /** Total conflicts across every category; an import runs only when this is 0. */
  conflicts: number;
};

/** The bundle's small records, kept in memory to apply them before the import job runs. */
export type BundleConfig = {
  header: HeaderRecord;
  locales: LocaleRecord[];
  definitions: DefinitionRecord[];
  appRoles: AppRoleRecord[];
  deliveryRoles: DeliveryRoleRecord[];
  webhooks: WebhookRecord[];
  connections: ConnectionRecord[];
  folders: MediaFolderRecord[];
  /** Models the bundle's entries belong to (for `--prune`). */
  entryModelIds: Set<string>;
};

export type ImportPlan = { diff: ImportDiff; config: BundleConfig };

const pushLimited = <T>(list: T[], item: T) => {
  if (list.length < LIST_LIMIT) {
    list.push(item);
  }
};

type Accumulator = {
  config: Omit<BundleConfig, 'header'> & { header: HeaderRecord | undefined };
  diff: Pick<ImportDiff, 'appUsers' | 'media' | 'entries'>;
  entryIds: Set<string>;
  assetIds: Set<string>;
};

const newAccumulator = (): Accumulator => ({
  config: {
    header: undefined,
    locales: [],
    definitions: [],
    appRoles: [],
    deliveryRoles: [],
    webhooks: [],
    connections: [],
    folders: [],
    entryModelIds: new Set(),
  },
  diff: {
    appUsers: { added: 0, unchanged: 0, conflicts: [], conflictCount: 0 },
    media: {
      folders: { added: 0, unchanged: 0 },
      added: 0,
      unchanged: 0,
      conflicts: [],
      conflictCount: 0,
      files: [],
    },
    entries: { added: 0, updated: 0, unchanged: 0, conflicts: [], conflictCount: 0, byModel: {} },
  },
  entryIds: new Set(),
  assetIds: new Set(),
});

const planUsers = async (acc: Accumulator, users: readonly AppUserRecord[]) => {
  const existing = await transferImportRepository.findAppUsers(
    users.map((user) => user.id),
    users.map((user) => user.email),
  );
  for (const user of users) {
    const holder = existing.emails.get(user.email.toLowerCase());
    if (existing.ids.has(user.id)) {
      acc.diff.appUsers.unchanged += 1;
    } else if (holder && holder !== user.id) {
      acc.diff.appUsers.conflictCount += 1;
      pushLimited(acc.diff.appUsers.conflicts, {
        id: user.id,
        reason: 'emailTaken',
        detail: `${user.email} belongs to another account on the target`,
      });
    } else {
      acc.diff.appUsers.added += 1;
    }
  }
};

const planAssets = async (acc: Accumulator, assets: readonly MediaAssetRecord[]) => {
  const existing = new Map(
    (await transferImportRepository.findAssets(assets.map((asset) => asset.id))).map((row) => [row.id, row]),
  );
  const media = acc.diff.media;
  for (const asset of assets) {
    acc.assetIds.add(asset.id);
    const target = existing.get(asset.id);
    const conflict = (reason: string, detail: string) => {
      media.conflictCount += 1;
      pushLimited(media.conflicts, { id: asset.id, reason, detail });
    };
    if (!target) {
      media.added += 1;
      media.files.push({
        assetId: asset.id,
        storageKey: asset.storageKey,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
      });
    } else if (target.deleted_at !== null) {
      conflict('deletedOnTarget', `${asset.filename} was deleted on the target`);
    } else if (
      target.storage_key !== asset.storageKey ||
      (asset.sha256 !== null && target.checksum_sha256 !== null && target.checksum_sha256 !== asset.sha256)
    ) {
      conflict('changedOnTarget', `${asset.filename} was replaced on the target`);
    } else {
      media.unchanged += 1;
    }
  }
};

type PlannedEntry = { entry: EntryRecord; classification: EntryClassification };

/** Classifies entries against the target in one query per batch. Shared by the plan and the import job. */
export const classifyEntries = async (entries: readonly EntryRecord[]): Promise<PlannedEntry[]> => {
  const ids = entries.map((entry) => entry.id);
  const targets = new Map((await transferImportRepository.findEntries(ids)).map((row) => [row.id, row]));
  const heads = Map.groupBy(await transferImportRepository.findHeads(ids), (head) => head.entry_id);
  return entries.map((entry) => ({
    entry,
    classification: classifyEntry(entry, targets.get(entry.id), heads.get(entry.id) ?? []),
  }));
};

const planEntries = async (
  acc: Accumulator,
  entries: readonly EntryRecord[],
  modelKey: (modelId: string) => string | undefined,
  knownLocale: (code: string) => boolean,
) => {
  const totals = acc.diff.entries;
  for (const { entry, classification } of await classifyEntries(entries)) {
    acc.entryIds.add(entry.id);
    acc.config.entryModelIds.add(entry.modelId);
    const model = modelKey(entry.modelId);
    const perModel = (totals.byModel[model ?? entry.modelId] ??= {
      added: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    });
    const missingLocale = entry.heads.find((head) => !knownLocale(head.locale))?.locale;
    const conflict =
      model === undefined
        ? {
            reason: 'unknownModel',
            detail: `model ${entry.modelId} is neither in the bundle nor on the target`,
          }
        : missingLocale !== undefined
          ? {
              reason: 'unknownLocale',
              detail: `locale ${missingLocale} is neither in the bundle nor on the target`,
            }
          : classification.kind === 'conflict'
            ? {
                reason: classification.reason,
                ...(classification.detail ? { detail: classification.detail } : {}),
              }
            : undefined;
    if (conflict) {
      totals.conflictCount += 1;
      perModel.conflicts += 1;
      pushLimited(totals.conflicts, { id: entry.id, ...(model ? { model } : {}), ...conflict });
      continue;
    }
    const kind = classification.kind as 'added' | 'updated' | 'unchanged';
    totals[kind] += 1;
    perModel[kind] += 1;
  }
};

/** Reads the bundle once: small records are kept, users, assets and entries are classified in batches. */
const scanBundle = async (context: SchemaServiceContext, input: Readable, acc: Accumulator) => {
  const users: AppUserRecord[] = [];
  const assets: MediaAssetRecord[] = [];
  const entries: EntryRecord[] = [];
  const definitionKeys = new Map<string, string>();
  const bundleLocales = new Set<string>();
  const modelKey = (id: string) => definitionKeys.get(id) ?? context.snapshot.byId.get(id)?.definition.apiKey;
  const knownLocale = (code: string) =>
    bundleLocales.has(code) || context.snapshot.locales.some((locale) => locale.code === code);
  const flush = async (force: boolean) => {
    if (users.length >= BATCH || (force && users.length > 0)) {
      await planUsers(acc, users.splice(0));
    }
    if (assets.length >= BATCH || (force && assets.length > 0)) {
      await planAssets(acc, assets.splice(0));
    }
    if (entries.length >= BATCH / 2 || (force && entries.length > 0)) {
      await planEntries(acc, entries.splice(0), modelKey, knownLocale);
    }
  };
  for await (const { record } of readBundle(input)) {
    switch (record.type) {
      case 'header':
        acc.config.header = record;
        break;
      case 'locale':
        acc.config.locales.push(record);
        bundleLocales.add(record.code);
        break;
      case 'definition':
        acc.config.definitions.push(record);
        definitionKeys.set(String(record.definition.id), String(record.definition.apiKey));
        break;
      case 'appRole':
        acc.config.appRoles.push(record);
        break;
      case 'deliveryRole':
        acc.config.deliveryRoles.push(record);
        break;
      case 'appUser':
        users.push(record);
        break;
      case 'webhook':
        acc.config.webhooks.push(record);
        break;
      case 'deploymentConnection':
        acc.config.connections.push(record);
        break;
      case 'mediaFolder':
        acc.config.folders.push(record);
        break;
      case 'mediaAsset':
        assets.push(record);
        break;
      case 'entry':
        entries.push(record);
        break;
      default:
        break;
    }
    await flush(false);
  }
  await flush(true);
};

const planLocales = async (
  context: SchemaServiceContext,
  locales: readonly LocaleRecord[],
): Promise<ImportDiff['locales']> => {
  const target = new Map(context.snapshot.locales.map((locale) => [locale.code, locale]));
  const diff: ImportDiff['locales'] = { added: [], changed: [], unchanged: [], defaultLocale: null };
  for (const locale of locales) {
    const existing = target.get(locale.code);
    if (!existing) {
      diff.added.push(locale.code);
    } else if (existing.label !== locale.label || existing.fallbacks.join() !== locale.fallbacks.join()) {
      diff.changed.push(locale.code);
    } else {
      diff.unchanged.push(locale.code);
    }
  }
  const bundleDefault = locales.find((locale) => locale.isDefault)?.code;
  if (bundleDefault && bundleDefault !== context.snapshot.defaultLocale) {
    // Changing the default changes what delivery falls back to: fine for an empty target only.
    diff.defaultLocale = {
      from: context.snapshot.defaultLocale,
      to: bundleDefault,
      blocked: await transferImportRepository.hasLiveEntries(),
    };
  }
  return diff;
};

const toSchemaItem = (item: SyncResultItem): SchemaItem => ({
  id: item.definitionId,
  apiKey: item.apiKey,
  kind: item.kind,
  ...(item.changes.length > 0 ? { changes: item.changes } : {}),
  ...(item.decision.action === 'conflict' ? { reason: item.decision.reason } : {}),
});

/**
 * The schema part through the same three-way sync as `shapio schema apply` (ADR 0002), against an empty
 * base: missing definitions are created with their IDs, identical ones skipped, and a definition the target
 * has in another form is a conflict. An import never changes an existing model.
 */
const planSchema = async (
  context: SchemaServiceContext,
  definitions: readonly DefinitionRecord[],
): Promise<ImportDiff['schema']> => {
  const diff: ImportDiff['schema'] = { added: [], unchanged: [], conflicts: [] };
  try {
    const result = await applySchema(context, {
      definitions: definitions.map((record) => record.definition),
      // A site definition lands on the target site; a shared one (or one from an older bundle) shared.
      scopes: definitions.map((record) => record.scope ?? 'network'),
      base: EMPTY_LOCK,
      prune: false,
      dryRun: true,
    });
    for (const item of result.results) {
      if (item.decision.action === 'create') {
        diff.added.push(toSchemaItem(item));
      } else if (item.decision.action === 'skip' && item.decision.reason === 'alreadyApplied') {
        diff.unchanged.push(toSchemaItem(item));
      }
    }
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'SCHEMA_SYNC_CONFLICT') {
      throw error;
    }
    const { conflicts } = error.details as { conflicts: SyncResultItem[] };
    diff.conflicts.push(...conflicts.map(toSchemaItem));
    // The refused sync reports conflicts only: the rest is plain hash comparison with the target.
    const conflicting = new Set(conflicts.map((item) => item.definitionId));
    for (const record of definitions) {
      const id = String(record.definition.id);
      if (conflicting.has(id)) {
        continue;
      }
      const target = context.snapshot.byId.get(id);
      const item = { id, apiKey: String(record.definition.apiKey), kind: String(record.definition.kind) };
      (target ? diff.unchanged : diff.added).push(item);
    }
  }
  return diff;
};

const planRoles = async (roles: readonly AppRoleRecord[]): Promise<ImportDiff['appRoles']> => {
  const existing = await appRolesRepository.listRoles();
  const grants = await appRolesRepository.listPermissionsForRoles(existing.map((role) => role.id));
  const diff: ImportDiff['appRoles'] = { added: [], updated: [], unchanged: [] };
  for (const role of roles) {
    const target = existing.find((candidate) => candidate.key === role.key);
    if (!target) {
      diff.added.push(role.key);
      continue;
    }
    const same =
      samePermissions(
        grants.filter((grant) => grant.role_id === target.id),
        role.permissions,
      ) &&
      (role.isSystem || (target.name === role.name && target.description === role.description));
    (same ? diff.unchanged : diff.updated).push(role.key);
  }
  return diff;
};

/** Delivery roles by key; a key the target uses for an admin role is a conflict. */
const planDeliveryRoles = async (
  roles: readonly DeliveryRoleRecord[],
): Promise<ImportDiff['deliveryRoles']> => {
  const existing = await adminRolesRepository.listRoles();
  const grants = await adminRolesRepository.listPermissionsForRoles(existing.map((role) => role.id));
  const diff: ImportDiff['deliveryRoles'] = { added: [], updated: [], unchanged: [], conflicts: [] };
  for (const role of roles) {
    const target = existing.find((candidate) => candidate.key === role.key);
    if (!target) {
      diff.added.push(role.key);
    } else if (target.kind !== 'delivery' || target.is_system) {
      diff.conflicts.push(role.key);
    } else {
      const same =
        samePermissions(
          grants.filter((grant) => grant.role_id === target.id),
          role.permissions,
        ) &&
        target.name === role.name &&
        target.description === role.description;
      (same ? diff.unchanged : diff.updated).push(role.key);
    }
  }
  return diff;
};

const planPublishing = async (
  config: Pick<BundleConfig, 'webhooks' | 'connections'>,
): Promise<Pick<ImportDiff, 'webhooks' | 'deploymentConnections'>> => {
  const webhooks: ImportDiff['webhooks'] = { added: [], unchanged: [] };
  for (const webhook of config.webhooks) {
    ((await webhooksRepository.findById(webhook.id)) ? webhooks.unchanged : webhooks.added).push(
      webhook.name,
    );
  }
  const connections: ImportDiff['deploymentConnections'] = { added: [], unchanged: [], needSecrets: [] };
  for (const connection of config.connections) {
    if (await deploymentConnectionsRepository.findById(connection.id)) {
      connections.unchanged.push(connection.name);
      continue;
    }
    connections.added.push(connection.name);
    connections.needSecrets.push(connection.name);
  }
  return { webhooks, deploymentConnections: connections };
};

/** Live target entries (of the bundle's models) and assets the bundle does not have. */
const planPrune = async (acc: Accumulator, siteId: string) => {
  let entries = 0;
  for (let after: string | null = null; ;) {
    const rows = await transferImportRepository.listLiveEntryIds(
      siteId,
      [...acc.config.entryModelIds],
      after,
      1000,
    );
    if (rows.length === 0) {
      break;
    }
    entries += rows.filter((row) => !acc.entryIds.has(row.id)).length;
    after = rows.at(-1)?.id ?? null;
  }
  let assets = 0;
  for (let after: string | null = null; ;) {
    const rows = await transferImportRepository.listLiveAssetIds(siteId, after, 1000);
    if (rows.length === 0) {
      break;
    }
    assets += rows.filter((row) => !acc.assetIds.has(row.id)).length;
    after = rows.at(-1)?.id ?? null;
  }
  return { entries, assets };
};

/** The import's target site: transfer routes are site routes, so the context is that site's view. */
const siteOf = (context: SchemaServiceContext): string => {
  if (context.snapshot.siteId === null) {
    throw new Error('An import plan needs the target site’s view of the schema');
  }
  return context.snapshot.siteId;
};

export const planImport = async (
  context: SchemaServiceContext,
  input: Readable,
  options: ImportOptions,
): Promise<ImportPlan> => {
  const acc = newAccumulator();
  await scanBundle(context, input, acc);
  const header = acc.config.header as HeaderRecord;
  const config: BundleConfig = { ...acc.config, header };
  const existingFolders = await transferImportRepository.findFolderIds(
    config.folders.map((folder) => folder.id),
  );
  acc.diff.media.folders = {
    added: config.folders.filter((folder) => !existingFolders.has(folder.id)).length,
    unchanged: existingFolders.size,
  };
  const diff: ImportDiff = {
    bundle: {
      exportedAt: header.exportedAt,
      shapioVersion: header.shapioVersion,
      schemaVersion: header.schemaVersion,
      snapshot: header.snapshot,
      options: header.options,
    },
    locales: await planLocales(context, config.locales),
    schema: await planSchema(context, config.definitions),
    appRoles: await planRoles(config.appRoles),
    deliveryRoles: await planDeliveryRoles(config.deliveryRoles),
    ...acc.diff,
    ...(await planPublishing(config)),
    prune: options.prune ? await planPrune(acc, siteOf(context)) : null,
    conflicts: 0,
  };
  diff.conflicts =
    (diff.locales.defaultLocale?.blocked ? 1 : 0) +
    diff.schema.conflicts.length +
    diff.deliveryRoles.conflicts.length +
    diff.appUsers.conflictCount +
    diff.media.conflictCount +
    diff.entries.conflictCount;
  return { diff, config };
};
