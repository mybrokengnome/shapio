import { ASSIST_CONTENT_OPS_JOB } from '../constants/assist.js';
import { runContentOpsJob, type ContentOpsJobDependencies } from '../services/assist/contentOpsJob.js';
import type { JobHandler } from './types.js';

/**
 * `assist.contentOps` (plan agentic-ecosystem §I). Registered whether assist is on or not: a run queued
 * before AI_PROVIDER was removed fails with ASSIST_DISABLED instead of being marked dead as unknown.
 */
export const createAssistJobHandlers = (deps: ContentOpsJobDependencies): Array<[string, JobHandler]> => [
  [ASSIST_CONTENT_OPS_JOB, (job) => runContentOpsJob(deps, job)],
];
