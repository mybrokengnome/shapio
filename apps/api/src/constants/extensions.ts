/** Extension points (package K, ADR 0009). */

/** Outbox event written in the content transaction when a project has `after*` hooks for the change. */
export const EXTENSION_HOOK_EVENT = 'extensions.hook';

/** Job that runs one post-commit hook for one outbox event. */
export const AFTER_HOOK_JOB = 'extensions.afterHook';

/** Project job handlers are registered under this prefix, so they never collide with Shapio's own. */
export const EXTENSION_JOB_PREFIX = 'ext.';

/** Custom routes are mounted under `${EXTENSION_ROUTE_ROOT}/<prefix>` (below BASE_PATH). */
export const EXTENSION_ROUTE_ROOT = '/api/ext';

/** The principal Shapio's own extension work (content reads in services, jobs) runs as by default. */
export const EXTENSION_SYSTEM_COMPONENT = 'extensions';
