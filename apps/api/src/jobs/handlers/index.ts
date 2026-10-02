import type { JobHandler, JobHandlers } from '../types.js';

/**
 * Registry of job handlers by type. Packages add their handlers here (publish-at, webhooks, backfill,
 * image variants, email, ...); the worker marks jobs of an unknown type dead rather than guessing.
 */
export const createJobHandlers = (extra: Iterable<[string, JobHandler]> = []): JobHandlers => new Map(extra);
