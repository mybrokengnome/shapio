import { startFakeJsonServer, type FakeResponse } from './fakeJsonServer.js';

/**
 * A local fake of the parts of the Netlify API the Netlify adapter uses, with the response shapes from
 * Netlify's OpenAPI document (https://open-api.netlify.com):
 *
 * - Start a build: `POST /api/v1/sites/{site_id}/builds` → Build `{ id, deploy_id, sha, done, error,
 *   created_at }`.
 * - Builds: `GET /api/v1/sites/{site_id}/builds` → Build[], newest first.
 * - Deploy: `GET /api/v1/deploys/{deploy_id}` → `{ id, site_id, build_id, state, name, url, ssl_url, admin_url,
 *   deploy_url, deploy_ssl_url, error_message, branch, context, created_at, updated_at, published_at }`.
 * - Site: `GET /api/v1/sites/{site_id}` → `{ id, name, url, ssl_url, admin_url, ... }`.
 * - Errors: `{ code: 401, message: "Access Denied: Invalid token" }`, `{ code: 404, message: "Not Found" }`.
 */
type Deploy = { id: string; buildId: string; createdAt: string; state: string; errorMessage: string | null };

const SITE_ID = '3f1c2a9e-5b7d-4c1e-9a0f-2b6d8e4c1a77';

const notFound: FakeResponse = { status: 404, body: { code: 404, message: 'Not Found' } };

/** `now` is the clock builds are stamped with (tests share it with the worker). */
export const startFakeNetlify = async (now: () => Date = () => new Date()) => {
  let counter = 0;
  const state = {
    siteId: SITE_ID,
    siteName: 'example-site',
    apiToken: 'netlify-test-token',
    buildCalls: 0,
    /** Whether a new build carries its deploy ID (Netlify's do). */
    buildReturnsDeployId: true,
    /** When set, the build starts but the API answers with this status (the answer is "lost"). */
    buildFailsWith: undefined as number | undefined,
    deploys: [] as Deploy[],
  };
  const adminUrl = `https://app.netlify.com/sites/${state.siteName}`;

  const build = (deploy: Deploy) => ({
    id: deploy.buildId,
    deploy_id: deploy.id,
    sha: null,
    done: deploy.state === 'ready' || deploy.state === 'error',
    error: deploy.errorMessage,
    created_at: deploy.createdAt,
  });

  const server = await startFakeJsonServer((request) => {
    if (request.headers.authorization !== `Bearer ${state.apiToken}`) {
      return { status: 401, body: { code: 401, message: 'Access Denied: Invalid token' } };
    }
    const site = `/api/v1/sites/${SITE_ID}`;
    if (request.method === 'GET' && request.path === site) {
      return {
        status: 200,
        body: {
          id: SITE_ID,
          name: state.siteName,
          ssl_url: `https://${state.siteName}.netlify.app`,
          admin_url: adminUrl,
        },
      };
    }
    if (request.method === 'POST' && request.path === `${site}/builds`) {
      state.buildCalls += 1;
      counter += 1;
      const deploy: Deploy = {
        id: `${counter}0f3a1b2c3d4e5f6a7b8c9d0e`,
        buildId: `${counter}b1d2a3c4e5f60718293a4b5c`,
        createdAt: now().toISOString(),
        state: 'enqueued',
        errorMessage: null,
      };
      state.deploys.unshift(deploy);
      if (state.buildFailsWith) {
        return { status: state.buildFailsWith, body: { code: state.buildFailsWith, message: 'Lost answer' } };
      }
      const created = build(deploy);
      return {
        status: 200,
        body: state.buildReturnsDeployId ? created : { ...created, deploy_id: undefined },
      };
    }
    if (request.method === 'GET' && request.path === `${site}/builds`) {
      return { status: 200, body: state.deploys.map(build) };
    }
    const deploy = state.deploys.find((candidate) => request.path === `/api/v1/deploys/${candidate.id}`);
    if (request.method === 'GET' && deploy) {
      return {
        status: 200,
        body: {
          id: deploy.id,
          site_id: SITE_ID,
          build_id: deploy.buildId,
          state: deploy.state,
          name: state.siteName,
          url: `http://${state.siteName}.netlify.app`,
          ssl_url: `https://${state.siteName}.netlify.app`,
          admin_url: adminUrl,
          deploy_url: `http://${deploy.id}--${state.siteName}.netlify.app`,
          deploy_ssl_url: `https://${deploy.id}--${state.siteName}.netlify.app`,
          error_message: deploy.errorMessage,
          context: 'production',
          created_at: deploy.createdAt,
        },
      };
    }
    return notFound;
  });

  return {
    ...server,
    state,
    apiUrl: server.url,
    adminUrl,
    setState: (id: string, next: string, errorMessage: string | null = null) => {
      const deploy = state.deploys.find((candidate) => candidate.id === id);
      if (!deploy) {
        throw new Error(`No deploy ${id}`);
      }
      deploy.state = next;
      deploy.errorMessage = errorMessage;
    },
  };
};

export type FakeNetlify = Awaited<ReturnType<typeof startFakeNetlify>>;
