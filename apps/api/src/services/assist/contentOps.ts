import { randomUUID } from 'node:crypto';
import {
  ASSIST_CONTENT_OPS_JOB,
  ASSIST_CONTENT_OPS_MAX_ATTEMPTS,
  type ContentOpsRule,
} from '../../constants/assist.js';
import { resolveModel } from '../../content/model.js';
import type { Database } from '../../db/index.js';
import { AppError } from '../../helpers/appError.js';
import { enqueueJob } from '../../jobs/queue.js';
import type { GlobalAction, PermissionEvaluator, Principal } from '../../permissions/types.js';
import * as assistRunsRepository from '../../repositories/assistRuns.js';
import * as jobsRepository from '../../repositories/jobs.js';
import { actorColumns } from '../../schema/planner/actor.js';
import type { SiteRef } from '../actorContext.js';
import type { ContentServiceContext } from '../contentAccess.js';
import type { AssistRuntime } from './context.js';
import { assertLocale } from './entrySource.js';

/**
 * Content-ops (plan §I): a job that works through up to 50 open health findings of one rule and proposes
 * fixes. `altMissing` proposes library alt texts as a review list (nothing is written; the person applies
 * each through the media update API); `localeMissing` writes missing locale drafts through the normal save
 * path into one change set (`source: 'assist'`). Nothing is published.
 */
export type ContentOpsInput = {
  rule: ContentOpsRule;
  /** Only findings of this model. */
  modelKey?: string | undefined;
  /** `localeMissing`: the locale translations are made from (default: the default locale). */
  fromLocale?: string | undefined;
};

export type ContentOpsJobPayload = {
  runId: string;
  rule: ContentOpsRule;
  modelKey: string | null;
  fromLocale: string | null;
};

type ContentOpsContext = {
  db: Database;
  site: SiteRef;
  actor: Principal;
  permissions: PermissionEvaluator;
};

/** Who may start a rule's run, and read anyone's run of it (besides the person who started it). */
export const CONTENT_OPS_PERMISSIONS: Readonly<
  Record<ContentOpsRule, { start: GlobalAction; readAny: GlobalAction }>
> = {
  altMissing: { start: 'media.read', readAny: 'media.write' },
  localeMissing: { start: 'changes.manage', readAny: 'changes.manage' },
};

const assertCan = async (context: ContentOpsContext, action: GlobalAction) => {
  if (!(await context.permissions.canPerform(context.actor, action))) {
    throw new AppError(403, 'FORBIDDEN', `Your role does not allow ${action}`);
  }
};

/** Queues a run: the run row and its job in one transaction. Returns the run ID (202). */
export const proposeContentOps = async (
  context: ContentServiceContext,
  runtime: AssistRuntime,
  input: ContentOpsInput,
): Promise<{ runId: string }> => {
  await assertCan(context, CONTENT_OPS_PERMISSIONS[input.rule].start);
  if (input.modelKey !== undefined) {
    resolveModel(context.snapshot, input.modelKey);
  }
  if (input.fromLocale !== undefined) {
    assertLocale(context, input.fromLocale);
  }
  const runId = randomUUID();
  const actor = actorColumns(context.actor);
  await context.db.transaction().execute(async (trx) => {
    const payload: ContentOpsJobPayload = {
      runId,
      rule: input.rule,
      modelKey: input.modelKey ?? null,
      fromLocale: input.fromLocale ?? null,
    };
    const { job } = await enqueueJob(
      {
        type: ASSIST_CONTENT_OPS_JOB,
        payload,
        maxAttempts: ASSIST_CONTENT_OPS_MAX_ATTEMPTS,
        idempotencyKey: `${ASSIST_CONTENT_OPS_JOB}:${runId}`,
      },
      trx,
    );
    await assistRunsRepository.insert(
      {
        id: runId,
        site_id: context.site.id,
        actor_type: actor.type,
        actor_id: actor.id ?? '',
        action: 'content_ops',
        rule: input.rule,
        provider: runtime.provider.id,
        model: runtime.config.model,
        status: 'queued',
        job_id: job.id,
      },
      trx,
    );
  });
  return { runId };
};

export type ContentOpsRunView = {
  runId: string;
  rule: ContentOpsRule;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  model: string;
  createdAt: string;
  finishedAt: string | null;
  error: { code: string } | null;
  /** The job's result once it succeeded; null before, or after the finished job was pruned. */
  result: unknown;
};

const runNotFound = (runId: string) =>
  new AppError(404, 'ASSIST_RUN_NOT_FOUND', `No content-ops run ${runId}`, { runId });

/**
 * A run of this site, for the person who started it or anyone allowed to act on its proposals
 * (`changes.manage` for missing locales, `media.write` for alt texts). Everyone else gets 404.
 */
export const getContentOpsRun = async (
  context: ContentOpsContext,
  runId: string,
): Promise<ContentOpsRunView> => {
  const run = await assistRunsRepository.findOnSite(context.site.id, runId, context.db);
  if (!run || run.action !== 'content_ops' || !run.rule) {
    throw runNotFound(runId);
  }
  const rule = run.rule as ContentOpsRule;
  const actor = actorColumns(context.actor);
  const isStarter = actor.type === run.actor_type && actor.id === run.actor_id;
  if (
    !isStarter &&
    !(await context.permissions.canPerform(context.actor, CONTENT_OPS_PERMISSIONS[rule].readAny))
  ) {
    throw runNotFound(runId);
  }
  const job =
    run.job_id && run.status === 'succeeded'
      ? await jobsRepository.findById(run.job_id, context.db)
      : undefined;
  return {
    runId: run.id,
    rule,
    status: run.status as ContentOpsRunView['status'],
    model: run.model,
    createdAt: run.created_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
    error: run.error_code ? { code: run.error_code } : null,
    result: job?.result ?? null,
  };
};
