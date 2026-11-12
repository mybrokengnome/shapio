import { randomUUID } from 'node:crypto';
import { createContentPorts } from '../../src/content/ports.js';
import { createTransferJobHandlers } from '../../src/content/transfer/job.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';
import { createMediaJobHandlers } from '../../src/media/jobs.js';
import { createSchemaJobHandlers } from '../../src/schema/planner/changeJob.js';
import type { World } from './itemModelWorld.js';
import { silentLogger } from './silentLogger.js';

/**
 * Import bundles for the item-write model (review 8, dup/imp1, imp2, loc2): export, a crafted edit of one
 * entry's heads (each edited head on a new revision on top of the old), and an import run to its end by a worker.
 */

export const exportBundle = async (w: World): Promise<string> =>
  (await w.request('GET', '/api/admin/transfer/export', w.adminToken)).raw;

export const importBundle = async (w: World, bundle: string): Promise<string> => {
  const worker = createWorker({
    db: w.db,
    handlers: createJobHandlers([
      ...createTransferJobHandlers({ db: w.db, storage: w.testApp.app.mediaStorage }),
      ...createMediaJobHandlers({ db: w.db, storage: w.testApp.app.mediaStorage }),
      ...createSchemaJobHandlers({ db: w.db, ports: createContentPorts(w.db) }),
    ]),
    workerId: `item-model-${randomUUID()}`,
    concurrency: 1,
    pollIntervalMs: 20,
    leaseMs: 30_000,
    log: silentLogger,
  });
  worker.start();
  try {
    const started = await w.testApp.app.inject({
      method: 'POST',
      url: '/api/admin/transfer/import',
      headers: { authorization: `Bearer ${w.adminToken}`, 'content-type': 'application/x-ndjson' },
      payload: bundle,
    });
    if (started.statusCode !== 202) {
      return `refused ${started.statusCode} ${started.body.slice(0, 300)}`;
    }
    const importId = started.json<{ importId: string }>().importId;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const state = (await w.request('GET', `/api/admin/transfer/imports/${importId}`, w.adminToken))
        .body as {
        status?: string;
        lastError?: string;
      };
      if (['succeeded', 'failed', 'dead'].includes(String(state.status))) {
        return `${String(state.status)} ${state.lastError ?? ''}`;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return 'timeout';
  } finally {
    await worker.stop(5_000);
  }
};

/** The bundle with one entry's heads edited (`edit(data, head)`), each on a new revision. */
export const craftBundle = (
  bundle: string,
  entryId: string,
  edit: (data: Record<string, unknown>, head: { locale: string; state: string }) => Record<string, unknown>,
): string =>
  bundle
    .split('\n')
    .map((line) => {
      if (!line.includes(entryId) || !line.includes('"type":"entry"')) {
        return line;
      }
      const record = JSON.parse(line) as {
        id: string;
        heads: Array<{
          locale: string;
          state: string;
          data: Record<string, unknown>;
          revisionId: string;
          version?: number;
        }>;
        revisions: Array<{ id: string } & Record<string, unknown>>;
      };
      if (record.id !== entryId) {
        return line;
      }
      const made = new Map<string, string>();
      for (const head of record.heads) {
        const data = edit(JSON.parse(JSON.stringify(head.data)) as Record<string, unknown>, head);
        const key = `${head.revisionId}:${JSON.stringify(data)}`;
        let revision = made.get(key);
        if (!revision) {
          revision = randomUUID();
          made.set(key, revision);
          const old = record.revisions.find((candidate) => candidate.id === head.revisionId);
          record.revisions.push({
            ...old,
            id: revision,
            data,
            parentRevisionId: head.revisionId,
            reason: 'save',
          });
        }
        head.data = data;
        head.revisionId = revision;
        head.version = (head.version ?? 1) + 1;
      }
      return JSON.stringify(record);
    })
    .join('\n');
