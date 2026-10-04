import { DEPLOYMENT_PROVIDERS } from '../../deployments/providers/index.js';
import type { DeploymentProviderId } from '../../deployments/types.js';
import { generateToken } from '../../helpers/tokens.js';
import type { FieldVisibilityLookup } from '../../permissions/policy.js';
import type { PublishingRuntime } from '../../publishing/runtime.js';
import * as adminRolesRepository from '../../repositories/adminRoles.js';
import * as appRolesRepository from '../../repositories/appRoles.js';
import * as deploymentConnectionsRepository from '../../repositories/deploymentConnections.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import * as webhooksRepository from '../../repositories/webhooks.js';
import type { SiteActorContext } from '../../services/actorContext.js';
import { createAppRole, updateAppRole } from '../../services/appRoles.js';
import type { AppPermissionInput } from '../../services/appRoles.js';
import { recordAudit } from '../../services/audit.js';
import { createLocale, setDefaultLocale, updateLocale } from '../../services/locales.js';
import { createRole, updateRole, type PermissionInput } from '../../services/roles.js';
import type { SchemaServiceContext } from '../../services/schemaAccess.js';
import { applySchema } from '../../services/schemaSync.js';
import { isValidEventPattern } from '../../webhooks/catalogue.js';
import type { ConnectionRecord, MediaFolderRecord, WebhookRecord } from './format.js';
import { samePermissions } from './permissions.js';
import { EMPTY_LOCK, type ImportPlan } from './plan.js';

/**
 * The small, instance-wide part of an import, applied in the request before the job imports content:
 * locales, then the schema (live, through the same sync as `shapio schema apply`), app and delivery roles, webhooks and
 * deployment connections (disabled, without secrets) and media folders. Each step goes through the
 * owning service, so validation, audit rows, version bumps and cache invalidation are the usual ones.
 */
export type ConfigDependencies = {
  /** A schema context on the current snapshot (re-read after each step that moves the schema). */
  schemaContext: () => Promise<SchemaServiceContext>;
  /** The request's context; its site receives the bundle's folders and deployment connections. */
  actor: SiteActorContext;
  publishing: PublishingRuntime;
  fieldVisibility: FieldVisibilityLookup;
};

export type AppliedConfig = {
  /** Planned schema changes (prerequisite jobs) the import job waits for. */
  pendingChangeIds: string[];
  /** Webhooks that got a new signing secret (shown once, like on creation). */
  webhookSecrets: Array<{ id: string; name: string; secret: string }>;
};

const applyLocales = async (deps: ConfigDependencies, plan: ImportPlan) => {
  const { locales } = plan.config;
  const added = new Set(plan.diff.locales.added);
  const known = new Set((await deps.schemaContext()).snapshot.locales.map((locale) => locale.code));
  // First create every missing locale (fallbacks that already exist only), then set every chain in full.
  for (const locale of locales.filter((candidate) => added.has(candidate.code))) {
    await createLocale(await deps.schemaContext(), {
      code: locale.code,
      label: locale.label,
      fallbacks: locale.fallbacks.filter((code) => known.has(code)),
    });
    known.add(locale.code);
  }
  const update = new Set([...plan.diff.locales.changed, ...added]);
  for (const locale of locales.filter((candidate) => update.has(candidate.code))) {
    await updateLocale(await deps.schemaContext(), locale.code, {
      label: locale.label,
      fallbacks: locale.fallbacks,
    });
  }
  const change = plan.diff.locales.defaultLocale;
  if (change && !change.blocked) {
    await setDefaultLocale(await deps.schemaContext(), change.to, true);
  }
};

const applyDefinitions = async (deps: ConfigDependencies, plan: ImportPlan): Promise<string[]> => {
  if (plan.diff.schema.added.length === 0) {
    return [];
  }
  const result = await applySchema(await deps.schemaContext(), {
    definitions: plan.config.definitions.map((record) => record.definition),
    scopes: plan.config.definitions.map((record) => record.scope ?? 'network'),
    base: EMPTY_LOCK,
    prune: false,
    dryRun: false,
  });
  return result.results.flatMap((item) =>
    item.outcome === 'pending' && item.changeId ? [item.changeId] : [],
  );
};

const applyRoles = async (deps: ConfigDependencies, plan: ImportPlan) => {
  const existing = await appRolesRepository.listRoles();
  const grants = await appRolesRepository.listPermissionsForRoles(existing.map((role) => role.id));
  for (const role of plan.config.appRoles) {
    const permissions = role.permissions as AppPermissionInput[];
    const target = existing.find((candidate) => candidate.key === role.key);
    if (!target) {
      await createAppRole(
        deps.actor,
        { key: role.key, name: role.name, description: role.description, permissions },
        deps.fieldVisibility,
      );
      continue;
    }
    const sameGrants = samePermissions(
      grants.filter((grant) => grant.role_id === target.id),
      role.permissions,
    );
    const sameText =
      target.is_system || (target.name === role.name && target.description === role.description);
    if (!sameGrants || !sameText) {
      await updateAppRole(
        deps.actor,
        target.id,
        {
          expectedVersion: target.version,
          ...(target.is_system ? {} : { name: role.name, description: role.description }),
          ...(sameGrants ? {} : { permissions }),
        },
        deps.fieldVisibility,
      );
    }
  }
};

/** Delivery roles by key, through the roles service (validation, audit, permissions version). */
const applyDeliveryRoles = async (deps: ConfigDependencies, plan: ImportPlan) => {
  const existing = await adminRolesRepository.listRoles();
  const changed = new Set([...plan.diff.deliveryRoles.added, ...plan.diff.deliveryRoles.updated]);
  for (const role of plan.config.deliveryRoles.filter((candidate) => changed.has(candidate.key))) {
    const permissions = role.permissions as PermissionInput[];
    const target = existing.find((candidate) => candidate.key === role.key);
    if (!target) {
      await createRole(
        deps.actor,
        { key: role.key, name: role.name, description: role.description, kind: 'delivery', permissions },
        deps.fieldVisibility,
      );
    } else {
      await updateRole(
        deps.actor,
        target.id,
        { expectedVersion: target.version, name: role.name, description: role.description, permissions },
        deps.fieldVisibility,
      );
    }
  }
};

const insertWebhook = async (deps: ConfigDependencies, webhook: WebhookRecord) => {
  const secret = `whsec_${generateToken()}`;
  await deps.publishing.db.transaction().execute(async (trx) => {
    await webhooksRepository.insert(
      {
        id: webhook.id,
        // A bundle's webhooks are its site's (an export carries only the site's own webhooks).
        site_id: deps.actor.site.id,
        name: webhook.name,
        url: webhook.url,
        events: webhook.events.filter(isValidEventPattern),
        // Imported disabled: the receiver must be given the new secret first (and a copy of production
        // must not call production's receivers by accident).
        enabled: false,
        allow_private_network: webhook.allowPrivateNetwork,
        max_attempts: webhook.maxAttempts,
        secret_encrypted: deps.publishing.secrets.encrypt(secret),
        created_by: null,
      },
      trx,
    );
    await recordAudit(trx, {
      ...deps.actor,
      action: 'webhook.create',
      target: { type: 'webhook', id: webhook.id },
      metadata: { name: webhook.name, url: webhook.url, source: 'import' },
    });
  });
  return { id: webhook.id, name: webhook.name, secret };
};

const insertConnection = async (deps: ConfigDependencies, connection: ConnectionRecord) => {
  const provider = DEPLOYMENT_PROVIDERS[connection.provider as DeploymentProviderId] as
    (typeof DEPLOYMENT_PROVIDERS)[DeploymentProviderId] | undefined;
  if (!provider) {
    return;
  }
  const secretNames = new Set(provider.secrets.map((spec) => spec.name));
  await deps.publishing.db.transaction().execute(async (trx) => {
    await deploymentConnectionsRepository.insert(
      {
        id: connection.id,
        site_id: deps.actor.site.id,
        name: connection.name,
        provider: provider.id,
        settings: JSON.stringify(connection.settings),
        // Literal secrets never leave an instance: only `${ENV:NAME}` references travel.
        secrets_encrypted: deps.publishing.secrets.encryptJson({}),
        secret_env_refs: JSON.stringify(
          Object.fromEntries(
            Object.entries(connection.secretEnvRefs).filter(([name]) => secretNames.has(name)),
          ),
        ),
        delivery_role_id: null,
        preview_url_template: connection.previewUrlTemplate,
        trigger_policy: connection.triggerPolicy,
        debounce_seconds: connection.debounceSeconds,
        allow_private_network: connection.allowPrivateNetwork,
        enabled: false,
        created_by: null,
      },
      trx,
    );
    await recordAudit(trx, {
      ...deps.actor,
      action: 'deployment_connection.create',
      target: { type: 'deployment_connection', id: connection.id },
      metadata: { name: connection.name, provider: provider.id, source: 'import' },
    });
  });
};

/** Parents before children, whatever order the bundle listed them in. */
export const orderFolders = (folders: readonly MediaFolderRecord[]): MediaFolderRecord[] => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ordered: MediaFolderRecord[] = [];
  const placed = new Set<string>();
  const place = (folder: MediaFolderRecord, depth: number) => {
    if (placed.has(folder.id) || depth > folders.length) {
      return;
    }
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (parent) {
      place(parent, depth + 1);
    }
    placed.add(folder.id);
    ordered.push(folder);
  };
  folders.forEach((folder) => place(folder, 0));
  return ordered;
};

export const applyConfig = async (deps: ConfigDependencies, plan: ImportPlan): Promise<AppliedConfig> => {
  await applyLocales(deps, plan);
  const pendingChangeIds = await applyDefinitions(deps, plan);
  await applyRoles(deps, plan);
  await applyDeliveryRoles(deps, plan);
  const webhookSecrets = [];
  for (const webhook of plan.config.webhooks) {
    if (!(await webhooksRepository.findById(webhook.id))) {
      webhookSecrets.push(await insertWebhook(deps, webhook));
    }
  }
  for (const connection of plan.config.connections) {
    if (!(await deploymentConnectionsRepository.findById(connection.id))) {
      await insertConnection(deps, connection);
    }
  }
  for (const folder of orderFolders(plan.config.folders)) {
    await transferImportRepository.insertFolder(deps.actor.site.id, folder);
  }
  return { pendingChangeIds, webhookSecrets };
};
