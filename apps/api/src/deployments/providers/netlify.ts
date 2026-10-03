import type { RunReport } from '../status.js';
import { runCheck, toTestResult } from '../testResult.js';
import type { DeploymentProviderAdapter, ProviderContext, RunContext } from '../types.js';
import { describeFailure, requestJson, type JsonResponse } from './http.js';
import { createdSince, toEpochMs } from './matching.js';

/**
 * Netlify. A run starts a build through the Netlify API and follows the deploy it produces, all with one
 * personal access token (Netlify has no read-only scope):
 *   POST {api}/api/v1/sites/{site_id}/builds  →  { id, deploy_id, sha, done, error, created_at }
 *   GET  {api}/api/v1/deploys/{deploy_id}     →  { id, state, ssl_url, deploy_ssl_url, admin_url, error_message }
 *   GET  {api}/api/v1/sites/{site_id}/builds  →  builds, newest first (to adopt a build after a crash)
 *   GET  {api}/api/v1/sites/{site_id}         →  { id, name }  (connection test)
 * Deploy states: new | pending_review | accepted | enqueued | building | uploading | uploaded | preparing |
 * prepared | processing | processed | ready | error | rejected | retrying | skipped | canceled. Only `ready`
 * is deployed; `skipped` and `canceled` mean the site was not updated, so the run fails.
 */
type NetlifyBuild = { id?: string; deploy_id?: string; created_at?: string };

type NetlifyDeploy = {
  id?: string;
  state?: string;
  ssl_url?: string | null;
  url?: string | null;
  deploy_ssl_url?: string | null;
  admin_url?: string | null;
  error_message?: string | null;
};

const WAITING_STATES = new Set(['new', 'pending_review', 'accepted', 'enqueued']);
const FAILED_STATES = new Set(['error', 'rejected']);
const NOT_UPDATED_STATES = new Set(['skipped', 'canceled', 'cancelled']);

const siteIdOf = (context: ProviderContext) => context.connection.settings.siteId ?? '';

const errorMessageOf = (response: JsonResponse) =>
  (response.json as { message?: string } | undefined)?.message;

const apiRequest = async <T>(context: ProviderContext, method: 'GET' | 'POST', path: string): Promise<T> => {
  const response = await requestJson(context.runtime, {
    url: `${context.runtime.config.netlifyApiUrl}/api/v1${path}`,
    method,
    headers: { authorization: `Bearer ${context.connection.secrets.apiToken ?? ''}` },
    ...(method === 'POST' ? { body: {} } : {}),
    policy: context.trustedPolicy,
    signal: context.signal,
  });
  if (!response.ok || response.json === undefined) {
    throw new Error(`Netlify API ${describeFailure(response, errorMessageOf(response))}`);
  }
  return response.json as T;
};

const sitePath = (context: ProviderContext) => `/sites/${encodeURIComponent(siteIdOf(context))}`;

const linkOf = (value: string | null | undefined) =>
  value && /^https?:\/\//.test(value) ? value : undefined;

/** Maps a Netlify deploy to a run report. Never reports success unless the deploy is ready. */
export const netlifyReportOf = (deploy: NetlifyDeploy): RunReport => {
  const state = deploy.state ?? 'new';
  const adminUrl = linkOf(deploy.admin_url);
  const details = {
    providerRef: deploy.id,
    logUrl: adminUrl && deploy.id ? `${adminUrl}/deploys/${encodeURIComponent(deploy.id)}` : undefined,
  };
  if (state === 'ready') {
    return {
      ...details,
      status: 'deployed',
      message: 'Netlify: published',
      siteUrl: linkOf(deploy.deploy_ssl_url) ?? linkOf(deploy.ssl_url) ?? linkOf(deploy.url),
    };
  }
  if (FAILED_STATES.has(state)) {
    return {
      ...details,
      status: 'failed',
      message: deploy.error_message ? `Netlify: ${deploy.error_message}` : `Netlify: the deploy ${state}`,
    };
  }
  if (NOT_UPDATED_STATES.has(state)) {
    return {
      ...details,
      status: 'failed',
      message: `Netlify: the build was ${state}; the site was not updated`,
    };
  }
  if (WAITING_STATES.has(state)) {
    return { ...details, status: 'triggered', message: `Netlify: ${state}` };
  }
  return { ...details, status: 'building', message: `Netlify: ${state}` };
};

const getDeploy = (context: ProviderContext, deployId: string) =>
  apiRequest<NetlifyDeploy>(context, 'GET', `/deploys/${encodeURIComponent(deployId)}`);

/** The newest build of the site created after `since` that already has its deploy (Netlify lists newest first). */
const findBuildSince = async (context: ProviderContext, since: Date) => {
  const builds = await apiRequest<NetlifyBuild[]>(context, 'GET', `${sitePath(context)}/builds`);
  return (Array.isArray(builds) ? builds : []).find(
    (build) => build.deploy_id && createdSince(toEpochMs(build.created_at), since),
  );
};

const deployOf = async (context: RunContext) => {
  const id = context.run.provider_ref;
  if (id) {
    return getDeploy(context, id);
  }
  const build = await findBuildSince(context, context.run.triggered_at ?? context.run.created_at);
  return build?.deploy_id ? getDeploy(context, build.deploy_id) : undefined;
};

export const netlifyProvider: DeploymentProviderAdapter = {
  id: 'netlify',
  settings: [{ name: 'siteId', required: true, pattern: /^[A-Za-z0-9.-]{1,253}$/ }],
  secrets: [{ name: 'apiToken', required: true }],
  reportsCompletion: true,
  // Only the operator-configured Netlify API is called; there is no admin-entered destination.
  destinations: () => [],
  trigger: async (context) => {
    // A crash after the build was started but before the run was updated: adopt that build's deploy
    // instead of starting a second build for the same run.
    if (context.previousAttemptAt) {
      const adopted = await findBuildSince(context, context.previousAttemptAt);
      if (adopted?.deploy_id) {
        const report = netlifyReportOf(await getDeploy(context, adopted.deploy_id));
        // A failure keeps its own message; otherwise say why no second build was started.
        return report.status === 'failed'
          ? report
          : { ...report, message: 'Netlify: resumed tracking the build started earlier' };
      }
    }
    const build = await apiRequest<NetlifyBuild>(context, 'POST', `${sitePath(context)}/builds`);
    return {
      status: 'triggered',
      message: 'Netlify started a build',
      ...(build.deploy_id ? { providerRef: build.deploy_id } : {}),
    };
  },
  poll: async (context) => {
    const deploy = await deployOf(context);
    if (!deploy) {
      return { status: 'triggered', message: 'Netlify has not listed the build yet' };
    }
    return netlifyReportOf(deploy);
  },
  test: async (context) =>
    toTestResult([
      await runCheck('apiToken', async () => {
        const site = await apiRequest<{ name?: string }>(context, 'GET', sitePath(context));
        return `The API token can manage site "${site.name ?? siteIdOf(context)}"`;
      }),
    ]),
};
