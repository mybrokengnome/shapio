import { startFakeJsonServer, type FakeResponse } from './fakeJsonServer.js';

/**
 * A local fake of the parts of the Vercel REST API the Vercel adapter uses, with the response shapes from
 * Vercel's API documentation:
 *
 * - Deploy hook: `POST /v1/integrations/deploy/{projectId}/{hookId}` → `{ job: { id, state: "PENDING",
 *   createdAt } }` (a build job, not the deployment).
 * - List: `GET /v6/deployments?projectId=&teamId=&since=&limit=` → `{ deployments: [{ uid, name, url, created,
 *   state, type, creator, inspectorUrl, meta, target, createdAt, buildingAt, ready }], pagination: { count,
 *   next, prev } }`, newest first; hook deployments carry `meta.deployHookId`.
 * - One: `GET /v13/deployments/{id}?teamId=` → `{ id, url, name, readyState: QUEUED | INITIALIZING | BUILDING |
 *   READY | ERROR | CANCELED, inspectorUrl, errorMessage, createdAt, meta, target }`.
 * - Project: `GET /v9/projects/{idOrName}?teamId=` → `{ id, name, accountId, framework, ... }`.
 * - Errors: `{ error: { code: "forbidden", message: "Not authorized" } }` with 403, `not_found` with 404.
 */
export type VercelState = 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';

type Deployment = {
  uid: string;
  created: number;
  state: VercelState;
  hookId: string | undefined;
  errorMessage: string | null;
};

const PROJECT_ID = 'prj_example123';
const HOOK_ID = 'hk9secretHookPath';

const notFound: FakeResponse = { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } };

/** `now` is the clock deployments are stamped with (tests share it with the worker). */
export const startFakeVercel = async (now: () => Date = () => new Date()) => {
  let counter = 0;
  const state = {
    projectId: PROJECT_ID,
    projectName: 'example-site',
    teamId: 'team_example',
    apiToken: 'vercel-test-token',
    hookCalls: 0,
    /** When set, the hook starts the deployment but answers with this status (the answer is "lost"). */
    hookFailsWith: undefined as number | undefined,
    deployments: [] as Deployment[],
  };

  const addDeployment = (hookId: string | undefined, at = now()) => {
    counter += 1;
    const deployment: Deployment = {
      uid: `dpl_${counter}abc`,
      created: at.getTime(),
      state: 'QUEUED',
      hookId,
      errorMessage: null,
    };
    state.deployments.unshift(deployment);
    return deployment;
  };

  const listed = (deployment: Deployment) => ({
    uid: deployment.uid,
    name: state.projectName,
    url: `${state.projectName}-${deployment.uid.slice(4)}.vercel.app`,
    created: deployment.created,
    createdAt: deployment.created,
    state: deployment.state,
    type: 'LAMBDAS',
    target: 'production',
    inspectorUrl: `https://vercel.com/example/${state.projectName}/${deployment.uid}`,
    meta: deployment.hookId ? { deployHookId: deployment.hookId, deployHookName: 'Shapio' } : {},
  });

  const single = (deployment: Deployment) => {
    const { uid, state: readyState, ...rest } = listed(deployment);
    return { ...rest, id: uid, readyState, errorMessage: deployment.errorMessage };
  };

  const server = await startFakeJsonServer((request) => {
    if (request.method === 'POST' && request.path === `/v1/integrations/deploy/${PROJECT_ID}/${HOOK_ID}`) {
      state.hookCalls += 1;
      addDeployment(HOOK_ID);
      if (state.hookFailsWith) {
        return { status: state.hookFailsWith, body: { error: { code: 'internal', message: 'Lost answer' } } };
      }
      return {
        status: 201,
        body: { job: { id: `job_${state.hookCalls}`, state: 'PENDING', createdAt: now().getTime() } },
      };
    }
    if (request.headers.authorization !== `Bearer ${state.apiToken}`) {
      return { status: 403, body: { error: { code: 'forbidden', message: 'Not authorized' } } };
    }
    if (request.query.get('teamId') !== state.teamId) {
      return notFound;
    }
    if (request.method === 'GET' && request.path === `/v9/projects/${PROJECT_ID}`) {
      return { status: 200, body: { id: PROJECT_ID, name: state.projectName, framework: 'astro' } };
    }
    if (request.method === 'GET' && request.path === '/v6/deployments') {
      if (request.query.get('projectId') !== PROJECT_ID) {
        return notFound;
      }
      const since = Number(request.query.get('since') ?? 0);
      const deployments = state.deployments.filter((deployment) => deployment.created >= since).map(listed);
      return {
        status: 200,
        body: { deployments, pagination: { count: deployments.length, next: null, prev: null } },
      };
    }
    const found = state.deployments.find(
      (deployment) => request.path === `/v13/deployments/${deployment.uid}`,
    );
    if (request.method === 'GET' && found) {
      return { status: 200, body: single(found) };
    }
    return notFound;
  });

  return {
    ...server,
    state,
    apiUrl: server.url,
    deployHookUrl: `${server.url}/v1/integrations/deploy/${PROJECT_ID}/${HOOK_ID}`,
    hookPath: `/v1/integrations/deploy/${PROJECT_ID}/${HOOK_ID}`,
    /** A deployment the hook did not start (a git push), to check the run is matched to the right one. */
    addDeployment,
    setState: (uid: string, next: VercelState, errorMessage: string | null = null) => {
      const deployment = state.deployments.find((candidate) => candidate.uid === uid);
      if (!deployment) {
        throw new Error(`No deployment ${uid}`);
      }
      deployment.state = next;
      deployment.errorMessage = errorMessage;
    },
  };
};

export type FakeVercel = Awaited<ReturnType<typeof startFakeVercel>>;
