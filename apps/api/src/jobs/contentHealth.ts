import type { Kysely } from 'kysely';
import { MEDIA_EVENTS } from '../constants/media.js';
import type { DB } from '../db/types.js';
import * as mediaReferencesRepository from '../repositories/mediaReferences.js';
import { createSchemaRegistry } from '../schema/registry.js';
import { evaluateEntry, sweepPage, type HealthEnvironment } from '../services/contentHealth.js';
import { enqueueJob } from './queue.js';
import type { JobHandler, JobLogger, OutboxSubscriber } from './types.js';

/**
 * Content health jobs (plan editor-experience §9):
 * - `content.health.entry`: re-evaluates one entry. Enqueued for every entry event (saves, publishes,
 *   deletes) and for the entries using an asset whose library metadata changed. Autosaves emit no event;
 *   the publish pre-flight and the daily sweep cover them.
 * - `content.health.sweep`: re-evaluates every live entry (or those of some models) in ID order, with a
 *   checkpoint. Runs daily (time-based rules such as stale drafts), after a schema activation (required
 *   flags, new fields) and after locales change (the locale-missing rule).
 */
export const CONTENT_HEALTH_JOBS = {
  entry: 'content.health.entry',
  sweep: 'content.health.sweep',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 200;

const dailyKey = (at: Date) => `${CONTENT_HEALTH_JOBS.sweep}:daily:${at.toISOString().slice(0, 10)}`;

/** Ensures today's daily sweep exists (no-op when it was already created or ran). */
export const ensureHealthSweepScheduled = (db: Kysely<DB>, now = new Date()) =>
  enqueueJob(
    { type: CONTENT_HEALTH_JOBS.sweep, runAt: now, payload: { daily: true }, idempotencyKey: dailyKey(now) },
    db,
  );

type SweepPayload = { daily?: boolean; modelIds?: string[] };
type SweepCheckpoint = { after: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type ContentHealthJobOptions = { db: Kysely<DB>; staleDays: number; log: JobLogger };

export const createContentHealthJobHandlers = ({
  db,
  staleDays,
  log,
}: ContentHealthJobOptions): Array<[string, JobHandler]> => {
  const registry = createSchemaRegistry({ db, log });
  const environment = async (): Promise<HealthEnvironment> => ({
    db,
    snapshot: await registry.getSnapshot(),
    staleDays,
  });
  const entry: JobHandler = async (job) => {
    const entryId = isRecord(job.payload) ? job.payload.entryId : undefined;
    if (typeof entryId !== 'string') {
      return { skipped: 'no entry' };
    }
    const findings = await evaluateEntry(await environment(), entryId);
    return { findings: findings.length };
  };
  const sweep: JobHandler = async (job) => {
    const payload = (isRecord(job.payload) ? job.payload : {}) as SweepPayload;
    const env = await environment();
    let after = (job.checkpoint as SweepCheckpoint | null)?.after ?? null;
    let evaluated = 0;
    for (;;) {
      const page = await sweepPage(
        env,
        { after, limit: SWEEP_BATCH, ...(payload.modelIds ? { modelIds: payload.modelIds } : {}) },
        job.signal,
      );
      evaluated += page.evaluated;
      if (page.next === null) {
        break;
      }
      after = page.next;
      await job.saveCheckpoint({ after } satisfies SweepCheckpoint);
      if (job.signal.aborted) {
        throw new Error('content health sweep interrupted by shutdown; it resumes from its checkpoint');
      }
    }
    if (payload.daily) {
      const next = new Date(Date.now() + DAY_MS);
      await enqueueJob(
        {
          type: CONTENT_HEALTH_JOBS.sweep,
          runAt: next,
          payload: { daily: true },
          idempotencyKey: dailyKey(next),
        },
        db,
      );
    }
    return { evaluated };
  };
  return [
    [CONTENT_HEALTH_JOBS.entry, entry],
    [CONTENT_HEALTH_JOBS.sweep, sweep],
  ];
};

/** Turns domain events into health re-evaluations, in the relay's transaction (ADR 0007). */
export const contentHealthOutboxSubscriber: OutboxSubscriber = async (event, trx) => {
  if (event.aggregate_type === 'entry') {
    await enqueueJob(
      {
        type: CONTENT_HEALTH_JOBS.entry,
        payload: { entryId: event.aggregate_id },
        idempotencyKey: `health:${event.event_id}`,
      },
      trx,
    );
    return;
  }
  if (event.type === MEDIA_EVENTS.updated) {
    const entryIds = await mediaReferencesRepository.listEntryIdsForAsset(event.aggregate_id, trx);
    for (const entryId of entryIds) {
      await enqueueJob(
        {
          type: CONTENT_HEALTH_JOBS.entry,
          payload: { entryId },
          idempotencyKey: `health:${event.event_id}:${entryId}`,
        },
        trx,
      );
    }
    return;
  }
  // A model's activation re-checks its entries; a component's (embedded anywhere) or a locale change, all.
  if (event.type === 'schema.activated' || event.aggregate_type === 'locale') {
    const modelIds = event.aggregate_type === 'model' ? [event.aggregate_id] : undefined;
    await enqueueJob(
      {
        type: CONTENT_HEALTH_JOBS.sweep,
        payload: modelIds ? { modelIds } : {},
        idempotencyKey: `health:${event.event_id}`,
      },
      trx,
    );
  }
};
