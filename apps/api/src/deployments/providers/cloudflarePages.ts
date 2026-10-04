import { parseDestination } from '../../publishing/outbound/ssrf.js';
import type { RunReport } from '../status.js';
import { runCheck, toTestResult } from '../testResult.js';
import type { DeploymentProviderAdapter, ProviderContext, RunContext } from '../types.js';
import { describeFailure, requestJson, type JsonResponse } from './http.js';
import { createdSince, toEpochMs } from './matching.js';

/**
 * Cloudflare Pages (build plan decision 5). A run is triggered through the project's deploy hook and its real
 * state is then read from the Cloudflare API with an API token (Pages: Read):
 *   POST <deploy hook URL>  →  { success, errors, messages, result: { id } }
 *   GET  {api}/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}
 *   GET  {api}/accounts/{account_id}/pages/projects/{project_name}/deployments  (newest first)
 * A deployment's `latest_stage` ({ name: queued | initialize | clone_repo | build | deploy, status: idle |
 * active | success | failure | canceled | skipped }) gives the state: only `deploy` + `success` is deployed.
 * When the hook does not return the deployment ID, the run is matched to the newest deploy-hook deployment
 * created after the trigger was sent. The hook answers 304 (no Location) when a deployment is already queued
 * for its branch, for example by a git push: nothing new is created, so the run follows that deployment.
 */
type CloudflareEnvelope<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type CloudflareStage = {
  name?: string;
  status?: string;
  started_on?: string | null;
  ended_on?: string | null;
};

export type CloudflareDeployment = {
  id: string;
  url?: string;
  created_on?: string;
  environment?: string;
  latest_stage?: CloudflareStage;
  deployment_trigger?: { type?: string; metadata?: Record<string, unknown> };
};

const envelopeOf = <T>(response: JsonResponse) => (response.json ?? {}) as CloudflareEnvelope<T>;

const errorMessageOf = (response: JsonResponse) =>
  envelopeOf<unknown>(response)
    .errors?.map((error) => [error.code, error.message].filter(Boolean).join(' '))
    .join('; ');

const settingsOf = (context: ProviderContext) => ({
  accountId: context.connection.settings.accountId ?? '',
  projectName: context.connection.settings.projectName ?? '',
});

const apiRequest = async <T>(context: ProviderContext, path: string): Promise<T> => {
  const response = await requestJson(context.runtime, {
    url: `${context.runtime.config.cloudflareApiUrl}${path}`,
    method: 'GET',
    headers: { authorization: `Bearer ${context.connection.secrets.apiToken ?? ''}` },
    policy: context.trustedPolicy,
    signal: context.signal,
  });
  const envelope = envelopeOf<T>(response);
  if (!response.ok || envelope.success === false || envelope.result === undefined) {
    throw new Error(`Cloudflare API ${describeFailure(response, errorMessageOf(response))}`);
  }
  return envelope.result;
};

const projectPath = (context: ProviderContext) => {
  const { accountId, projectName } = settingsOf(context);
  return `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
};

const logUrlOf = (context: ProviderContext, deploymentId: string) => {
  const { accountId, projectName } = settingsOf(context);
  return `${context.runtime.config.cloudflareDashboardUrl}/${encodeURIComponent(accountId)}/pages/view/${encodeURIComponent(projectName)}/${encodeURIComponent(deploymentId)}`;
};

/** Maps a Cloudflare deployment to a run report. Never reports success unless the deploy stage succeeded. */
export const reportOf = (context: ProviderContext, deployment: CloudflareDeployment): RunReport => {
  const stage = deployment.latest_stage ?? {};
  const name = stage.name ?? 'queued';
  const status = stage.status ?? 'idle';
  const details = { providerRef: deployment.id, logUrl: logUrlOf(context, deployment.id) };
  if (status === 'failure' || status === 'canceled') {
    return {
      ...details,
      status: 'failed',
      message: `Cloudflare: the ${name} stage ${status === 'canceled' ? 'was canceled' : 'failed'}`,
    };
  }
  if (name === 'deploy' && status === 'success') {
    return { ...details, status: 'deployed', message: 'Cloudflare: deployed', siteUrl: deployment.url };
  }
  if (name === 'queued') {
    return { ...details, status: 'triggered', message: 'Cloudflare: queued' };
  }
  return { ...details, status: 'building', message: `Cloudflare: ${name} (${status})` };
};

/** The newest deploy-hook deployment created after `since` (Cloudflare lists newest first). */
const findDeploymentSince = async (context: ProviderContext, since: Date) => {
  const deployments = await apiRequest<CloudflareDeployment[]>(
    context,
    `${projectPath(context)}/deployments`,
  );
  return deployments.find((deployment) => {
    const fromHook =
      deployment.deployment_trigger?.type === undefined ||
      deployment.deployment_trigger.type === 'deploy_hook';
    return fromHook && createdSince(toEpochMs(deployment.created_on), since);
  });
};

const isFinished = (deployment: CloudflareDeployment) => {
  const { name, status } = deployment.latest_stage ?? {};
  return (
    status === 'failure' ||
    status === 'canceled' ||
    status === 'skipped' ||
    (name === 'deploy' && status === 'success')
  );
};

/** The newest unfinished deployment, whatever started it (the build a 304 from the deploy hook refers to). */
const findPendingDeployment = async (context: ProviderContext) => {
  const deployments = await apiRequest<CloudflareDeployment[]>(
    context,
    `${projectPath(context)}/deployments`,
  );
  return deployments.find((deployment) => !isFinished(deployment));
};

/** A 304 without Location: Cloudflare already has a deployment queued for the hook's branch. */
const isAlreadyQueued = (response: JsonResponse) => response.status === 304 && !response.location;

const ALREADY_QUEUED_MESSAGE =
  'Cloudflare: a deployment was already queued for this branch (deploy hook HTTP 304), so no new one was started';

const followQueuedDeployment = async (context: RunContext): Promise<RunReport> => {
  const pending = await findPendingDeployment(context);
  if (!pending) {
    return { status: 'triggered', message: ALREADY_QUEUED_MESSAGE };
  }
  return { ...reportOf(context, pending), message: `${ALREADY_QUEUED_MESSAGE}; following it` };
};

const deploymentOf = (context: RunContext) => {
  const id = context.run.provider_ref;
  return id
    ? apiRequest<CloudflareDeployment>(
        context,
        `${projectPath(context)}/deployments/${encodeURIComponent(id)}`,
      )
    : findDeploymentSince(context, context.run.triggered_at ?? context.run.created_at);
};

export const cloudflarePagesProvider: DeploymentProviderAdapter = {
  id: 'cloudflare_pages',
  settings: [
    { name: 'accountId', required: true, pattern: /^[0-9a-f]{32}$/i },
    { name: 'projectName', required: true, pattern: /^[a-z0-9][a-z0-9-]{0,57}$/ },
  ],
  secrets: [
    { name: 'deployHookUrl', required: true },
    { name: 'apiToken', required: true },
  ],
  reportsCompletion: true,
  destinations: ({ secrets }) => (secrets.deployHookUrl ? [secrets.deployHookUrl] : []),
  trigger: async (context) => {
    // A crash after the hook was called but before the run was updated: adopt that deployment instead of
    // starting a second build for the same run.
    if (context.previousAttemptAt) {
      const adopted = await findDeploymentSince(context, context.previousAttemptAt);
      if (adopted) {
        return {
          ...reportOf(context, adopted),
          message: 'Cloudflare: resumed tracking the deployment started earlier',
        };
      }
    }
    const response = await requestJson(context.runtime, {
      url: context.connection.secrets.deployHookUrl ?? '',
      method: 'POST',
      policy: context.policy,
      signal: context.signal,
    });
    if (isAlreadyQueued(response)) {
      return followQueuedDeployment(context);
    }
    const envelope = envelopeOf<{ id?: string }>(response);
    if (!response.ok || envelope.success === false) {
      throw new Error(`Cloudflare deploy hook ${describeFailure(response, errorMessageOf(response))}`);
    }
    const id = envelope.result?.id;
    return {
      status: 'triggered',
      message: 'Cloudflare accepted the deploy hook',
      ...(id ? { providerRef: id, logUrl: logUrlOf(context, id) } : {}),
    };
  },
  poll: async (context) => {
    const deployment = await deploymentOf(context);
    if (!deployment) {
      return { status: 'triggered', message: 'Cloudflare has not listed the deployment yet' };
    }
    return reportOf(context, deployment);
  },
  test: async (context) => {
    const { accountId, projectName } = settingsOf(context);
    return toTestResult([
      await runCheck('apiToken', async () => {
        const project = await apiRequest<{ name?: string; subdomain?: string }>(
          context,
          projectPath(context),
        );
        return `The API token can read project "${project.name ?? projectName}" in account ${accountId}`;
      }),
      await runCheck('deployHookUrl', async () => {
        parseDestination(context.connection.secrets.deployHookUrl ?? '');
        return 'The deploy hook URL is set (it is not called by the test, which would start a build)';
      }),
    ]);
  },
};
