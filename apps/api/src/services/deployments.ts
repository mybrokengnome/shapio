import { providerContextFor, resolveConnection, settingsOf } from '../deployments/connections.js';
import { callbackPathFor } from '../deployments/providers/genericWebhook.js';
import { providerFor } from '../deployments/providers/index.js';
import { ensureQueuedRun } from '../deployments/runs.js';
import type { RunStatus, TimelineEvent } from '../deployments/status.js';
import { toTestResult, type ConnectionTestResult } from '../deployments/testResult.js';
import {
  TRIGGER_POLICIES,
  type ResolvedConnection,
  type DeploymentProviderAdapter,
  type DeploymentProviderId,
  type TriggerPolicy,
} from '../deployments/types.js';
import { AppError } from '../helpers/appError.js';
import { generateToken } from '../helpers/tokens.js';
import { assertDestinationAllowed } from '../publishing/destination.js';
import { decodeCursor, pageSize, toPage, type Page } from '../publishing/pagination.js';
import { renderPreviewUrl } from '../publishing/previewUrl.js';
import { adminIdOf } from '../publishing/principals.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import {
  envRefsOf,
  isSecretEnvAllowed,
  parseEnvReference,
  resolveSecretValues,
  secretEnvNotAllowed,
} from '../publishing/secretRefs.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import type { DeploymentConnectionRow } from '../repositories/deploymentConnections.js';
import * as deploymentRunsRepository from '../repositories/deploymentRuns.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

/**
 * Deployment connections and runs (package H, brief §7 "first-party website connection"). Secrets are
 * write-only: stored encrypted, reported only as set/unset, never logged or returned.
 */
export type RunView = {
  id: string;
  connectionId: string;
  connectionName: string;
  provider: DeploymentProviderId;
  status: RunStatus;
  trigger: 'publish' | 'change_set' | 'schema' | 'manual' | 'retry';
  snapshot: number | null;
  schemaVersion: number | null;
  retryOf: string | null;
  providerRef: string | null;
  logUrl: string | null;
  siteUrl: string | null;
  error: string | null;
  completionReported: boolean;
  timeline: TimelineEvent[];
  triggeredAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConnectionView = {
  id: string;
  name: string;
  provider: DeploymentProviderId;
  settings: Record<string, string>;
  /** `envVar`: the secret is read from this environment variable (`${ENV:NAME}`), never stored. */
  secrets: Record<string, { set: boolean; envVar: string | null }>;
  previewUrlTemplate: string | null;
  /** Preview tokens issued for this connection read with this delivery role's field grants. */
  deliveryRoleId: string | null;
  triggerPolicy: TriggerPolicy[];
  debounceSeconds: number;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  callbackUrl: string;
  latestRun: RunView | null;
  currentRun: RunView | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

type RunRow = NonNullable<Awaited<ReturnType<typeof deploymentRunsRepository.findViewById>>>;

export const toRunView = (row: RunRow): RunView => {
  const timeline = (Array.isArray(row.timeline) ? row.timeline : []) as TimelineEvent[];
  const provider = row.provider as DeploymentProviderId;
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    provider,
    status: row.status as RunStatus,
    trigger: row.trigger as RunView['trigger'],
    snapshot: row.snapshot_seq === null ? null : Number(row.snapshot_seq),
    schemaVersion: row.schema_version,
    retryOf: row.retry_of,
    providerRef: row.provider_ref,
    logUrl: row.log_url,
    siteUrl: row.site_url,
    error: row.error,
    completionReported:
      providerFor(provider).reportsCompletion || timeline.some((event) => event.source === 'callback'),
    timeline,
    triggeredAt: row.triggered_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const connectionNotFound = (id: string) =>
  new AppError(404, 'CONNECTION_NOT_FOUND', `No deployment connection ${id}`, { id });

const toConnectionView = (
  runtime: PublishingRuntime,
  row: DeploymentConnectionRow,
  runs: { latest?: RunRow | undefined; current?: RunRow | undefined },
): ConnectionView => {
  const provider = providerFor(row.provider);
  const stored = runtime.secrets.decryptJson(row.secrets_encrypted);
  const refs = envRefsOf(row.secret_env_refs);
  return {
    id: row.id,
    name: row.name,
    provider: provider.id,
    settings: settingsOf(row),
    secrets: Object.fromEntries(
      provider.secrets.map((secret) => [
        secret.name,
        { set: Boolean(stored[secret.name] ?? refs[secret.name]), envVar: refs[secret.name] ?? null },
      ]),
    ),
    previewUrlTemplate: row.preview_url_template,
    deliveryRoleId: row.delivery_role_id,
    triggerPolicy: row.trigger_policy as TriggerPolicy[],
    debounceSeconds: row.debounce_seconds,
    allowPrivateNetwork: row.allow_private_network,
    enabled: row.enabled,
    callbackUrl: runtime.urls.absoluteUrl(callbackPathFor(row.id)),
    latestRun: runs.latest ? toRunView(runs.latest) : null,
    currentRun: runs.current ? toRunView(runs.current) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
};

const viewsOf = async (runtime: PublishingRuntime, rows: readonly DeploymentConnectionRow[]) => {
  const ids = rows.map((row) => row.id);
  const [latest, current] = await Promise.all([
    deploymentRunsRepository.latestPerConnection(ids, runtime.db),
    deploymentRunsRepository.currentPerConnection(ids, runtime.db),
  ]);
  return rows.map((row) =>
    toConnectionView(runtime, row, {
      latest: latest.find((run) => run.connection_id === row.id),
      current: current.find((run) => run.connection_id === row.id),
    }),
  );
};

export const listConnections = async (runtime: PublishingRuntime) =>
  viewsOf(runtime, await deploymentConnectionsRepository.list(runtime.db));

export const getConnection = async (runtime: PublishingRuntime, id: string): Promise<ConnectionView> => {
  const row = await deploymentConnectionsRepository.findById(id, runtime.db);
  if (!row) {
    throw connectionNotFound(id);
  }
  const [view] = await viewsOf(runtime, [row]);
  return view as ConnectionView;
};

const invalid = (message: string, field: string) =>
  new AppError(400, 'INVALID_CONNECTION', message, { field });

const validateSettings = (provider: DeploymentProviderAdapter, input: Record<string, string>) => {
  const unknown = Object.keys(input).find((key) => !provider.settings.some((spec) => spec.name === key));
  if (unknown) {
    throw invalid(`"${unknown}" is not a setting of ${provider.id}`, `settings.${unknown}`);
  }
  const settings: Record<string, string> = {};
  for (const spec of provider.settings) {
    const value = (input[spec.name] ?? '').trim() || spec.defaultValue;
    if (!value) {
      if (spec.required) {
        throw invalid(`"${spec.name}" is required`, `settings.${spec.name}`);
      }
      continue;
    }
    if (spec.pattern && !spec.pattern.test(value)) {
      throw invalid(`"${spec.name}" is not valid`, `settings.${spec.name}`);
    }
    settings[spec.name] = value;
  }
  return settings;
};

type StoredSecrets = { literal: Record<string, string>; refs: Record<string, string> };

/**
 * Merges new secret values into the stored ones; empty values keep what is stored. A value of
 * `${ENV:NAME}` stores a reference to the environment variable instead of the value.
 */
const mergeSecrets = (
  provider: DeploymentProviderAdapter,
  stored: StoredSecrets,
  input: Record<string, string> | undefined,
  allowlist: readonly string[],
) => {
  const unknown = Object.keys(input ?? {}).find((key) => !provider.secrets.some((spec) => spec.name === key));
  if (unknown) {
    throw invalid(`"${unknown}" is not a secret of ${provider.id}`, `secrets.${unknown}`);
  }
  const literal = { ...stored.literal };
  const refs = { ...stored.refs };
  const generated: Record<string, string> = {};
  for (const spec of provider.secrets) {
    const value = input?.[spec.name]?.trim();
    const variable = value ? parseEnvReference(value) : undefined;
    if (variable && !isSecretEnvAllowed(variable, allowlist)) {
      throw secretEnvNotAllowed(spec.name, variable);
    }
    if (variable) {
      refs[spec.name] = variable;
      delete literal[spec.name];
    } else if (value) {
      literal[spec.name] = value;
      delete refs[spec.name];
    } else if (!literal[spec.name] && !refs[spec.name] && spec.generated) {
      const secret = `whsec_${generateToken()}`;
      literal[spec.name] = secret;
      generated[spec.name] = secret;
    } else if (!literal[spec.name] && !refs[spec.name] && spec.required) {
      throw invalid(`The secret "${spec.name}" is required`, `secrets.${spec.name}`);
    }
  }
  return { literal, refs, generated };
};

/** Preview tokens may only be bound to delivery roles (what a site's token holds). */
const validateDeliveryRole = async (runtime: PublishingRuntime, roleId: string | null | undefined) => {
  if (!roleId) {
    return null;
  }
  const role = await adminRolesRepository.findById(roleId, runtime.db);
  if (!role || role.kind !== 'delivery') {
    throw invalid('Choose a delivery role (the role of the token your site reads with)', 'deliveryRoleId');
  }
  return role.id;
};

/** Secrets as far as they can be known when saving (unset environment variables are checked on use). */
const knownSecrets = (runtime: PublishingRuntime, secrets: StoredSecrets) =>
  resolveSecretValues(secrets.literal, secrets.refs, runtime.env, {
    strict: false,
    allowlist: runtime.config.secretEnvAllowlist,
  });

const validateTriggers = (provider: DeploymentProviderAdapter, triggers: readonly string[]) => {
  const allowed: readonly string[] = provider.id === 'github' ? ['schema', 'manual'] : TRIGGER_POLICIES;
  const bad = triggers.find((trigger) => !allowed.includes(trigger));
  if (bad) {
    throw invalid(`"${bad}" is not a trigger ${provider.id} supports`, 'triggerPolicy');
  }
  return [...new Set(triggers)] as TriggerPolicy[];
};

const validatePreviewTemplate = (template: string | null | undefined) => {
  if (!template) {
    return null;
  }
  if (!template.includes('{token}')) {
    throw invalid('The preview URL template must contain {token}', 'previewUrlTemplate');
  }
  try {
    renderPreviewUrl(template, { token: 'token', modelKey: 'model', entryId: 'id', locale: 'en' });
  } catch {
    throw invalid('The preview URL template does not make a valid http(s) URL', 'previewUrlTemplate');
  }
  return template;
};

const assertDestinations = async (
  runtime: PublishingRuntime,
  provider: DeploymentProviderAdapter,
  connection: { settings: Record<string, string>; secrets: Record<string, string> },
  allowPrivateNetwork: boolean,
) => {
  for (const url of provider.destinations(connection)) {
    await assertDestinationAllowed(runtime, url, allowPrivateNetwork, 'destination');
  }
};

export type ConnectionInput = {
  name: string;
  provider: DeploymentProviderId;
  settings: Record<string, string>;
  secrets: Record<string, string>;
  previewUrlTemplate?: string | null;
  triggerPolicy: string[];
  debounceSeconds?: number;
  allowPrivateNetwork?: boolean;
  enabled?: boolean;
  deliveryRoleId?: string | null;
};

export const createConnection = async (
  runtime: PublishingRuntime,
  context: ActorContext,
  input: ConnectionInput,
): Promise<{ connection: ConnectionView; generatedSecrets: Record<string, string> }> => {
  const provider = providerFor(input.provider);
  const settings = validateSettings(provider, input.settings);
  const { literal, refs, generated } = mergeSecrets(
    provider,
    { literal: {}, refs: {} },
    input.secrets,
    runtime.config.secretEnvAllowlist,
  );
  const deliveryRoleId = await validateDeliveryRole(runtime, input.deliveryRoleId);
  const triggerPolicy = validateTriggers(provider, input.triggerPolicy);
  const previewUrlTemplate = validatePreviewTemplate(input.previewUrlTemplate);
  await assertDestinations(
    runtime,
    provider,
    { settings, secrets: knownSecrets(runtime, { literal, refs }) },
    input.allowPrivateNetwork ?? false,
  );
  const row = await runtime.db.transaction().execute(async (trx) => {
    const inserted = await deploymentConnectionsRepository.insert(
      {
        name: input.name.trim(),
        provider: provider.id,
        settings: JSON.stringify(settings),
        secrets_encrypted: runtime.secrets.encryptJson(literal),
        secret_env_refs: JSON.stringify(refs),
        delivery_role_id: deliveryRoleId,
        preview_url_template: previewUrlTemplate,
        trigger_policy: triggerPolicy,
        ...(input.debounceSeconds !== undefined ? { debounce_seconds: input.debounceSeconds } : {}),
        allow_private_network: input.allowPrivateNetwork ?? false,
        enabled: input.enabled ?? true,
        created_by: adminIdOf(context.actor),
      },
      trx,
    );
    await recordAudit(trx, {
      ...context,
      action: 'deployment_connection.create',
      target: { type: 'deployment_connection', id: inserted.id },
      metadata: { name: inserted.name, provider: provider.id, settings, triggerPolicy },
    });
    return inserted;
  });
  return { connection: await getConnection(runtime, row.id), generatedSecrets: generated };
};

export const updateConnection = async (
  runtime: PublishingRuntime,
  context: ActorContext,
  id: string,
  input: Partial<Omit<ConnectionInput, 'provider'>> & { expectedVersion: number },
): Promise<ConnectionView> => {
  const current = await deploymentConnectionsRepository.findById(id, runtime.db);
  if (!current) {
    throw connectionNotFound(id);
  }
  const provider = providerFor(current.provider);
  const settings = input.settings ? validateSettings(provider, input.settings) : settingsOf(current);
  const { literal, refs } = mergeSecrets(
    provider,
    {
      literal: runtime.secrets.decryptJson(current.secrets_encrypted),
      refs: envRefsOf(current.secret_env_refs),
    },
    input.secrets,
    runtime.config.secretEnvAllowlist,
  );
  const allowPrivateNetwork = input.allowPrivateNetwork ?? current.allow_private_network;
  await assertDestinations(
    runtime,
    provider,
    { settings, secrets: knownSecrets(runtime, { literal, refs }) },
    allowPrivateNetwork,
  );
  const deliveryRoleId =
    input.deliveryRoleId !== undefined
      ? await validateDeliveryRole(runtime, input.deliveryRoleId)
      : undefined;
  await runtime.db.transaction().execute(async (trx) => {
    const updated = await deploymentConnectionsRepository.update(
      id,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        settings: JSON.stringify(settings),
        secrets_encrypted: runtime.secrets.encryptJson(literal),
        secret_env_refs: JSON.stringify(refs),
        ...(deliveryRoleId !== undefined ? { delivery_role_id: deliveryRoleId } : {}),
        ...(input.previewUrlTemplate !== undefined
          ? { preview_url_template: validatePreviewTemplate(input.previewUrlTemplate) }
          : {}),
        ...(input.triggerPolicy !== undefined
          ? { trigger_policy: validateTriggers(provider, input.triggerPolicy) }
          : {}),
        ...(input.debounceSeconds !== undefined ? { debounce_seconds: input.debounceSeconds } : {}),
        allow_private_network: allowPrivateNetwork,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      input.expectedVersion,
      new Date(),
      trx,
    );
    if (!updated) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'The connection changed since you loaded it. Reload and try again.',
      );
    }
    await recordAudit(trx, {
      ...context,
      action: 'deployment_connection.update',
      target: { type: 'deployment_connection', id },
      metadata: {
        changes: Object.keys(input).filter((key) => key !== 'expectedVersion' && key !== 'secrets'),
        secretsReplaced: Object.keys(input.secrets ?? {}).filter((key) => input.secrets?.[key]),
      },
    });
  });
  return getConnection(runtime, id);
};

export const deleteConnection = async (runtime: PublishingRuntime, context: ActorContext, id: string) => {
  await runtime.db.transaction().execute(async (trx) => {
    const removed = await deploymentConnectionsRepository.deleteById(id, trx);
    if (removed.numDeletedRows === 0n) {
      throw connectionNotFound(id);
    }
    await recordAudit(trx, {
      ...context,
      action: 'deployment_connection.delete',
      target: { type: 'deployment_connection', id },
    });
  });
};

export const testConnection = async (
  runtime: PublishingRuntime,
  id: string,
): Promise<ConnectionTestResult> => {
  const row = await deploymentConnectionsRepository.findById(id, runtime.db);
  if (!row) {
    throw connectionNotFound(id);
  }
  let connection: ResolvedConnection;
  try {
    connection = resolveConnection(runtime, row);
  } catch (error) {
    return toTestResult([
      { name: 'secrets', ok: false, message: error instanceof Error ? error.message : String(error) },
    ]);
  }
  return providerFor(row.provider).test(providerContextFor(runtime, connection));
};

const runView = async (runtime: PublishingRuntime, id: string): Promise<RunView> => {
  const row = await deploymentRunsRepository.findViewById(id, runtime.db);
  if (!row) {
    throw new AppError(404, 'RUN_NOT_FOUND', `No deployment run ${id}`, { id });
  }
  return toRunView(row);
};

export const getRun = runView;

export const listRuns = async (
  runtime: PublishingRuntime,
  query: { connectionId?: string; cursor?: string; limit?: number },
): Promise<Page<RunView>> => {
  const limit = pageSize(query.limit);
  const rows = await deploymentRunsRepository.list(
    query.connectionId ? { connectionId: query.connectionId } : {},
    decodeCursor(query.cursor),
    limit + 1,
    runtime.db,
  );
  return toPage(rows, limit, toRunView);
};

/** A manual run (or a retry): queued now with no debounce, or the run already queued (coalesced). */
const queueRun = async (
  runtime: PublishingRuntime,
  context: ActorContext,
  row: DeploymentConnectionRow,
  trigger: 'manual' | 'retry',
  retryOf: string | null,
) => {
  if (!row.enabled) {
    throw new AppError(409, 'CONNECTION_DISABLED', 'Enable the connection first');
  }
  const runId = await runtime.db.transaction().execute(async (trx) => {
    const { run } = await ensureQueuedRun(trx, {
      connectionId: row.id,
      debounceSeconds: 0,
      trigger,
      createdBy: adminIdOf(context.actor),
      retryOf,
      now: runtime.now(),
    });
    await recordAudit(trx, {
      ...context,
      action: trigger === 'retry' ? 'deployment.retry' : 'deployment.trigger',
      target: { type: 'deployment_connection', id: row.id },
      metadata: { runId: run.id, retryOf },
    });
    return run.id;
  });
  return runView(runtime, runId);
};

export const triggerRun = async (runtime: PublishingRuntime, context: ActorContext, connectionId: string) => {
  const row = await deploymentConnectionsRepository.findById(connectionId, runtime.db);
  if (!row) {
    throw connectionNotFound(connectionId);
  }
  return queueRun(runtime, context, row, 'manual', null);
};

/** Retrying creates a new run (linked by `retryOf`) at the current snapshot; the failed run stays as it was. */
export const retryRun = async (runtime: PublishingRuntime, context: ActorContext, runId: string) => {
  const run = await deploymentRunsRepository.findById(runId, runtime.db);
  const row = run ? await deploymentConnectionsRepository.findById(run.connection_id, runtime.db) : undefined;
  if (!run || !row) {
    throw new AppError(404, 'RUN_NOT_FOUND', `No deployment run ${runId}`, { id: runId });
  }
  return queueRun(runtime, context, row, 'retry', run.id);
};
