import { parseDestination } from '../../publishing/outbound/ssrf.js';
import type { RunReport } from '../status.js';
import { runCheck, toTestResult } from '../testResult.js';
import type { DeploymentProviderAdapter, ProviderContext, RunContext } from '../types.js';
import { describeFailure, requestJson, type JsonResponse } from './http.js';
import { createdSince, MATCH_SKEW_MS, toEpochMs } from './matching.js';

/**
 * Vercel. A run is triggered through the project's deploy hook and its real state is then read from the
 * Vercel REST API with an API token:
 *   POST <deploy hook URL>                          →  { job: { id, state, createdAt } }  (a job, not a deployment)
 *   GET  {api}/v6/deployments?projectId=&teamId=&since=  →  { deployments: [{ uid, url, state, created,
 *        inspectorUrl, meta: { deployHookId? } }] }  (newest first)
 *   GET  {api}/v13/deployments/{id}?teamId=         →  { id, url, readyState, inspectorUrl, errorMessage }
 *   GET  {api}/v9/projects/{idOrName}?teamId=       →  { id, name }  (connection test)
 * The hook does not return the deployment, so the run is matched to the newest deployment of the project
 * created after the trigger was sent, preferring one whose `meta.deployHookId` is this hook's ID.
 * States: QUEUED | INITIALIZING | BUILDING | READY | ERROR | CANCELED; only READY is deployed.
 */
type VercelDeployment = {
  uid?: string;
  id?: string;
  url?: string;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  inspectorUrl?: string | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
};

const settingsOf = (context: ProviderContext) => ({
  projectId: context.connection.settings.projectId ?? '',
  teamId: context.connection.settings.teamId,
});

const errorMessageOf = (response: JsonResponse) =>
  (response.json as { error?: { message?: string } } | undefined)?.error?.message;

/** A Vercel API path with the team scope (and any other query parameters) appended. */
const apiPath = (context: ProviderContext, path: string, query: Record<string, string> = {}) => {
  const { teamId } = settingsOf(context);
  const params = new URLSearchParams({ ...query, ...(teamId ? { teamId } : {}) }).toString();
  return params ? `${path}?${params}` : path;
};

const apiRequest = async <T>(context: ProviderContext, path: string): Promise<T> => {
  const response = await requestJson(context.runtime, {
    url: `${context.runtime.config.vercelApiUrl}${path}`,
    method: 'GET',
    headers: { authorization: `Bearer ${context.connection.secrets.apiToken ?? ''}` },
    policy: context.trustedPolicy,
    signal: context.signal,
  });
  if (!response.ok || response.json === undefined) {
    throw new Error(`Vercel API ${describeFailure(response, errorMessageOf(response))}`);
  }
  return response.json as T;
};

/** The hook's own ID: the last segment of `…/v1/integrations/deploy/{projectId}/{hookId}`. */
const hookIdOf = (context: ProviderContext) => {
  try {
    return new URL(context.connection.secrets.deployHookUrl ?? '').pathname.split('/').filter(Boolean).pop();
  } catch {
    return undefined;
  }
};

const idOf = (deployment: VercelDeployment) => deployment.uid ?? deployment.id ?? '';

/** Vercel reports a deployment's address as a bare host name; the run shows it as a link. */
const httpsUrl = (host: string | undefined) => {
  if (!host || /^https?:\/\//.test(host)) {
    return host || undefined;
  }
  // A provider's host, not one of Shapio's own URLs (those come from PUBLIC_URL).
  // eslint-disable-next-line no-restricted-syntax
  return `https://${host}`;
};

/** Maps a Vercel deployment to a run report. Never reports success unless the deployment is READY. */
export const vercelReportOf = (deployment: VercelDeployment): RunReport => {
  const state = (deployment.readyState ?? deployment.state ?? 'QUEUED').toUpperCase();
  const details = {
    providerRef: idOf(deployment),
    logUrl: deployment.inspectorUrl ?? undefined,
  };
  switch (state) {
    case 'READY':
      return { ...details, status: 'deployed', message: 'Vercel: ready', siteUrl: httpsUrl(deployment.url) };
    case 'ERROR':
      return {
        ...details,
        status: 'failed',
        message: deployment.errorMessage ? `Vercel: ${deployment.errorMessage}` : 'Vercel: the build failed',
      };
    case 'CANCELED':
      return { ...details, status: 'failed', message: 'Vercel: the deployment was canceled' };
    case 'QUEUED':
    case 'INITIALIZING':
      return { ...details, status: 'triggered', message: `Vercel: ${state.toLowerCase()}` };
    default:
      return { ...details, status: 'building', message: `Vercel: ${state.toLowerCase()}` };
  }
};

/**
 * The deployment this hook started after `since` (Vercel lists newest first): one carrying this hook's ID,
 * or else the newest one that names no deploy hook at all.
 */
const findDeploymentSince = async (context: ProviderContext, since: Date) => {
  const { projectId } = settingsOf(context);
  const { deployments = [] } = await apiRequest<{ deployments?: VercelDeployment[] }>(
    context,
    apiPath(context, '/v6/deployments', {
      projectId,
      since: String(since.getTime() - MATCH_SKEW_MS),
      limit: '20',
    }),
  );
  const candidates = deployments.filter((deployment) =>
    createdSince(toEpochMs(deployment.created ?? deployment.createdAt), since),
  );
  const hookId = hookIdOf(context);
  return (
    candidates.find((deployment) => hookId !== undefined && deployment.meta?.deployHookId === hookId) ??
    candidates.find((deployment) => deployment.meta?.deployHookId === undefined)
  );
};

const getDeployment = (context: ProviderContext, id: string) =>
  apiRequest<VercelDeployment>(context, apiPath(context, `/v13/deployments/${encodeURIComponent(id)}`));

/** The run's deployment in full (the list leaves out details such as the error message). */
const deploymentOf = async (context: RunContext) => {
  const id =
    context.run.provider_ref ??
    idOf((await findDeploymentSince(context, context.run.triggered_at ?? context.run.created_at)) ?? {});
  return id ? getDeployment(context, id) : undefined;
};

export const vercelProvider: DeploymentProviderAdapter = {
  id: 'vercel',
  settings: [
    { name: 'projectId', required: true, pattern: /^[A-Za-z0-9._-]{1,100}$/ },
    { name: 'teamId', required: false, pattern: /^[A-Za-z0-9._-]{1,100}$/ },
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
        const report = vercelReportOf(adopted);
        // A failure keeps its own message; otherwise say why no second build was started.
        return report.status === 'failed'
          ? report
          : { ...report, message: 'Vercel: resumed tracking the deployment started earlier' };
      }
    }
    const response = await requestJson(context.runtime, {
      url: context.connection.secrets.deployHookUrl ?? '',
      method: 'POST',
      policy: context.policy,
      signal: context.signal,
    });
    if (!response.ok) {
      throw new Error(`Vercel deploy hook ${describeFailure(response, errorMessageOf(response))}`);
    }
    return { status: 'triggered', message: 'Vercel accepted the deploy hook' };
  },
  poll: async (context) => {
    const deployment = await deploymentOf(context);
    if (!deployment) {
      return { status: 'triggered', message: 'Vercel has not listed the deployment yet' };
    }
    return vercelReportOf(deployment);
  },
  test: async (context) => {
    const { projectId } = settingsOf(context);
    return toTestResult([
      await runCheck('apiToken', async () => {
        const project = await apiRequest<{ name?: string }>(
          context,
          apiPath(context, `/v9/projects/${encodeURIComponent(projectId)}`),
        );
        return `The API token can read project "${project.name ?? projectId}"`;
      }),
      await runCheck('deployHookUrl', async () => {
        parseDestination(context.connection.secrets.deployHookUrl ?? '');
        return 'The deploy hook URL is set (it is not called by the test, which would start a build)';
      }),
    ]);
  },
};
