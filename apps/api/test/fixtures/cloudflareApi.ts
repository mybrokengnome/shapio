import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local fake of the parts of the Cloudflare API the Pages adapter uses, with the response shapes from
 * Cloudflare's API documentation (v4 envelope: `{ success, errors, messages, result, result_info? }`):
 *
 * - Deploy hook: `POST /pages/webhooks/deploy_hooks/{id}` → `{ success: true, errors: [], messages: [],
 *   result: { id: "<deployment id>" } }`.
 * - Project: `GET /client/v4/accounts/{account_id}/pages/projects/{project_name}` → `result: { id, name,
 *   subdomain, domains, production_branch, created_on, ... }`.
 * - Deployments: `GET .../deployments` → `result: Deployment[]` newest first with `result_info: { page,
 *   per_page, count, total_count, total_pages }`; `GET .../deployments/{deployment_id}` → `result: Deployment`.
 * - Deployment: `{ id, short_id, project_id, project_name, environment: "production" | "preview", url,
 *   created_on, modified_on, aliases, is_skipped, latest_stage: { name, started_on, ended_on, status },
 *   stages: [{ name: queued | initialize | clone_repo | build | deploy, started_on, ended_on, status: idle |
 *   active | success | failure | canceled | skipped }], deployment_trigger: { type: "ad_hoc" | "github:push" |
 *   "deploy_hook", metadata: { branch, commit_hash, commit_message, commit_dirty } } }`.
 * - Errors: `{ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [],
 *   result: null }` with 403.
 */
export type FakeStage = 'queued' | 'initialize' | 'clone_repo' | 'build' | 'deploy';
export type FakeStageStatus = 'idle' | 'active' | 'success' | 'failure' | 'canceled';

type Deployment = {
  id: string;
  created_on: string;
  stage: FakeStage;
  status: FakeStageStatus;
};

const STAGES: readonly FakeStage[] = ['queued', 'initialize', 'clone_repo', 'build', 'deploy'];

export type FakeCloudflare = {
  url: string;
  apiUrl: string;
  deployHookUrl: string;
  accountId: string;
  projectName: string;
  apiToken: string;
  hookCalls: number;
  /** Whether the deploy hook response includes the deployment ID (it does on Cloudflare). */
  hookReturnsId: boolean;
  deployments: Deployment[];
  setStage: (id: string, stage: FakeStage, status: FakeStageStatus) => void;
  close: () => Promise<void>;
};

const envelope = (result: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ success: true, errors: [], messages: [], result, ...extra });

const toDeployment = (fake: FakeCloudflare, deployment: Deployment) => ({
  id: deployment.id,
  short_id: deployment.id.slice(0, 8),
  project_id: 'project-id',
  project_name: fake.projectName,
  environment: 'production',
  url: `https://${deployment.id.slice(0, 8)}.${fake.projectName}.pages.dev`,
  created_on: deployment.created_on,
  modified_on: deployment.created_on,
  aliases: null,
  is_skipped: false,
  latest_stage: {
    name: deployment.stage,
    started_on: deployment.created_on,
    ended_on: null,
    status: deployment.status,
  },
  stages: STAGES.map((name) => ({
    name,
    started_on: null,
    ended_on: null,
    status:
      STAGES.indexOf(name) < STAGES.indexOf(deployment.stage)
        ? 'success'
        : name === deployment.stage
          ? deployment.status
          : 'idle',
  })),
  deployment_trigger: {
    type: 'deploy_hook',
    metadata: { branch: 'main', commit_hash: 'abc123', commit_message: 'Deploy hook', commit_dirty: false },
  },
});

/** `now` is the clock deployments are stamped with (tests share it with the worker). */
export const startFakeCloudflare = async (now: () => Date = () => new Date()): Promise<FakeCloudflare> => {
  let counter = 0;
  const fake = {
    accountId: '0123456789abcdef0123456789abcdef',
    projectName: 'example-site',
    apiToken: 'cf-test-token',
    hookCalls: 0,
    hookReturnsId: true,
    deployments: [] as Deployment[],
  } as FakeCloudflare;

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    req.resume();
    req.on('end', () => {
      if (req.method === 'POST' && path === '/pages/webhooks/deploy_hooks/hook-1') {
        fake.hookCalls += 1;
        counter += 1;
        const deployment: Deployment = {
          id: `dep-${counter}-${'0'.repeat(24)}`,
          created_on: now().toISOString(),
          stage: 'queued',
          status: 'idle',
        };
        fake.deployments.unshift(deployment);
        send(200, envelope(fake.hookReturnsId ? { id: deployment.id } : {}));
        return;
      }
      if (req.headers.authorization !== `Bearer ${fake.apiToken}`) {
        send(
          403,
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
            messages: [],
            result: null,
          }),
        );
        return;
      }
      const project = `/client/v4/accounts/${fake.accountId}/pages/projects/${fake.projectName}`;
      if (req.method === 'GET' && path === project) {
        send(
          200,
          envelope({
            id: 'project-id',
            name: fake.projectName,
            subdomain: `${fake.projectName}.pages.dev`,
            production_branch: 'main',
          }),
        );
        return;
      }
      if (req.method === 'GET' && path === `${project}/deployments`) {
        send(
          200,
          envelope(
            fake.deployments.map((deployment) => toDeployment(fake, deployment)),
            {
              result_info: {
                page: 1,
                per_page: 25,
                count: fake.deployments.length,
                total_count: fake.deployments.length,
                total_pages: 1,
              },
            },
          ),
        );
        return;
      }
      const single = fake.deployments.find(
        (deployment) => path === `${project}/deployments/${deployment.id}`,
      );
      if (req.method === 'GET' && single) {
        send(200, envelope(toDeployment(fake, single)));
        return;
      }
      send(
        404,
        JSON.stringify({
          success: false,
          errors: [{ code: 8000007, message: 'Project not found' }],
          messages: [],
          result: null,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.url = `http://127.0.0.1:${port}`;
  fake.apiUrl = `${fake.url}/client/v4`;
  fake.deployHookUrl = `${fake.url}/pages/webhooks/deploy_hooks/hook-1`;
  fake.setStage = (id, stage, status) => {
    const deployment = fake.deployments.find((candidate) => candidate.id === id);
    if (!deployment) {
      throw new Error(`No deployment ${id}`);
    }
    deployment.stage = stage;
    deployment.status = status;
  };
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
};
