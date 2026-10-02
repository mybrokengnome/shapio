import type { FastifyBaseLogger, FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import type { RouteAuditConfig } from '../plugins/auditDeclaration.js';

// What Shapio adds to Fastify, repeated here so custom route code is typed without the server's internals.
declare module 'fastify' {
  interface FastifyRequest {
    /** Who is calling. Anonymous unless a session cookie or API token resolved. Never null after onRequest. */
    principal: Principal;
  }
  interface FastifyContextConfig {
    /** Required on every mutating route: the audit action recorded on success, or `{ exempt: '<why>' }`. */
    audit?: RouteAuditConfig;
  }
}

/**
 * The project extension contract (ADR 0009), imported by project authors from `shapio/config`:
 *
 * ```ts
 * import { defineConfig } from 'shapio/config';
 * export const config = defineConfig({ hooks: { article: { beforePublish: (ctx) => { ... } } } });
 * ```
 *
 * Extensions are code: changing them needs a restart of Shapio (never a rebuild). Content models are never
 * configured here; they change live in the admin. This file has no runtime imports from the server, so a
 * config that imports it stays cheap to load.
 *
 * Stability: everything exported here follows semver with `EXTENSION_CONTRACT_VERSION`; Shapio's database
 * tables (reachable through `trx`) are internal and may change in any release.
 */
export const EXTENSION_CONTRACT_VERSION = 1;

export type BeforeHookEvent = 'beforeCreate' | 'beforeUpdate' | 'beforePublish' | 'beforeDelete';
export type AfterHookEvent = 'afterCreate' | 'afterUpdate' | 'afterPublish' | 'afterDelete';
export type HookEvent = BeforeHookEvent | AfterHookEvent;

/** Entry data keyed by field API key (the admin API's shape; media and relations are IDs). */
export type EntryData = Readonly<Record<string, unknown>>;

export type HookModel = {
  /** Stable model ID (never changes). */
  id: string;
  apiKey: string;
  label: string;
  kind: 'collection' | 'singleton';
  localized: boolean;
  draftAndPublish: boolean;
};

export type HookEntry = {
  id: string;
  locale: string | null;
  /** Which head the change is about: the draft (create/update), the live version (publish), or a delete. */
  state: 'draft' | 'published' | 'deleted';
};

export type ContentReadOptions = {
  locale?: string;
  /** Read as this principal (its permissions apply). Default: Shapio itself (everything). */
  principal?: Principal;
};

export type ContentReadEntry = {
  id: string;
  locale: string;
  status: string;
  data: Record<string, unknown>;
};

/** Read-only access to content (drafts, as the admin API shows them). Reads committed data. */
export type ContentReadService = {
  get: (modelKey: string, id: string, options?: ContentReadOptions) => Promise<ContentReadEntry>;
  /** `query` is a delivery-style querystring, e.g. `filters[title][$contains]=a&pageSize=10`. */
  list: (
    modelKey: string,
    query?: string,
    options?: Omit<ContentReadOptions, 'locale'>,
  ) => Promise<{ items: ContentReadEntry[]; total: number }>;
  /** Number of (non-deleted) entries of a model. */
  count: (modelKey: string) => Promise<number>;
  /** The active content models (collections and singletons). */
  models: () => Promise<HookModel[]>;
};

export type MediaUsage = {
  entryId: string;
  modelId: string;
  fieldId: string;
  locale: string;
  state: string;
};

export type MediaReferenceService = {
  /** Where an asset is used (up to 100 references, plus the total). */
  usages: (assetId: string) => Promise<{ items: MediaUsage[]; total: number }>;
};

export type EnqueueOptions = {
  runAt?: Date;
  /** Enqueueing the same key twice creates one job. */
  idempotencyKey?: string;
  maxAttempts?: number;
};

export type ExtensionJobService = {
  /** Enqueues one of the project's own jobs (`jobs` in the config), by its name without the `ext.` prefix. */
  enqueue: (
    name: string,
    payload?: Record<string, unknown>,
    options?: EnqueueOptions,
  ) => Promise<{ id: string; created: boolean }>;
};

/** What Shapio offers extensions. Deliberately small; everything else goes through `trx` or HTTP. */
export type ShapioServices = {
  content: ContentReadService;
  media: MediaReferenceService;
  jobs: ExtensionJobService;
  logger: FastifyBaseLogger;
};

/**
 * Your own services, by name. Augment it for typed access everywhere services appear:
 *
 * ```ts
 * declare module 'shapio/config' {
 *   interface CustomServices { stats: StatsService }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by projects
export interface CustomServices {}

export type ExtensionServices = ShapioServices & CustomServices;

type HookContextBase = {
  model: HookModel;
  entry: HookEntry;
  locale: string | null;
  /** The document after the change (absent for deletes). */
  data: EntryData | undefined;
  /** The document before the change: the previous draft (update) or the live version (publish). */
  before: EntryData | undefined;
  /** Who made the change (an admin, an API token, an app user, or Shapio itself for scheduled work). */
  principal: Principal;
  services: ExtensionServices;
  logger: FastifyBaseLogger;
  /** Aborted when Shapio shuts down. */
  signal: AbortSignal;
};

/**
 * `before*` hooks run INSIDE the write's transaction, before it commits. Throw `HookError` (or call
 * `reject`) to abort the write with 422 `HOOK_REJECTED`; nothing of the write is kept. Other errors abort it
 * too, as a 500. Database work through `trx` commits or rolls back with the write.
 */
export type BeforeHookContext = HookContextBase & {
  event: BeforeHookEvent;
  trx: Transaction<DB>;
  reject: (message: string, details?: Record<string, unknown>) => never;
};

/**
 * `after*` hooks run AFTER the write committed, as a job (retried with backoff on error, never rolling the
 * write back). Database work through `trx` is exactly once: it commits together with the record that the
 * hook ran. Other side effects (HTTP calls) are at least once: make them idempotent with `idempotencyKey`.
 */
export type AfterHookContext = HookContextBase & {
  event: AfterHookEvent;
  trx: Transaction<DB>;
  /** The outbox event the hook runs for. */
  eventId: string;
  /** `<eventId>:<hook name>`: stable across retries. */
  idempotencyKey: string;
  attempt: number;
};

export type BeforeHook = (context: BeforeHookContext) => Promise<void> | void;
export type AfterHook = (context: AfterHookContext) => Promise<void> | void;

export type ModelHooks = { [E in BeforeHookEvent]?: BeforeHook } & { [E in AfterHookEvent]?: AfterHook };

export type ServiceFactoryContext = {
  /** Kysely on Shapio's database. Shapio's own tables are internal and may change between releases. */
  db: Kysely<DB>;
  config: ExtensionHostConfig;
  logger: FastifyBaseLogger;
  /** Shapio's services plus the custom services declared before this one. */
  services: ExtensionServices;
};

export type ExtensionHostConfig = {
  nodeEnv: 'development' | 'production' | 'test';
  /** PUBLIC_URL origin, without a trailing slash. */
  publicUrl: string;
  basePath: string;
  /** The directory holding shapio.config and extensions/. */
  projectDir: string;
};

export type ServiceFactory = (context: ServiceFactoryContext) => unknown;

/** Options every custom route plugin receives (also available as `app.ext`). */
export type ExtensionRouteOptions = {
  services: ExtensionServices;
  /** Shapio's permission evaluator: `permissions.evaluate(request.principal, { action, modelId })`. */
  permissions: PermissionEvaluator;
  logger: FastifyBaseLogger;
  /** preHandler: 401/403 unless the caller is an admin user or an admin API token. */
  requireAdmin: preHandlerAsyncHookHandler;
};

export type ExtensionRoute = {
  /** Mounted at `/api/ext/<prefix>` (under BASE_PATH). Lower-case letters, digits and dashes. */
  prefix: string;
  plugin: FastifyPluginAsync<ExtensionRouteOptions>;
};

export type JobHandlerContext = {
  jobId: string;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  services: ExtensionServices;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
};

/** Throw to retry with backoff; the return value (JSON) is stored as the job result. */
export type ExtensionJobHandler = (context: JobHandlerContext) => Promise<unknown>;

export type ShapioConfig = {
  /** Lifecycle hooks by model API ID (or stable model UUID); `*` runs for every model. */
  hooks?: Record<string, ModelHooks>;
  routes?: ExtensionRoute[];
  /** Constructed once at startup, in order, and shared by hooks, routes and jobs. */
  services?: Record<string, ServiceFactory>;
  /** Custom field editor modules: file names inside `extensions/editors/` (built ES modules). */
  editors?: string[];
  /** Job handlers by name; registered as `ext.<name>`. */
  jobs?: Record<string, ExtensionJobHandler>;
};

/** Identity helper for completion and type checking in `shapio.config.ts`. */
export const defineConfig = (config: ShapioConfig): ShapioConfig => config;

const HOOK_ERROR_BRAND = Symbol.for('shapio.HookError');

/**
 * Thrown by a `before*` hook to reject a write: the API answers 422 with code `HOOK_REJECTED`, this message
 * and the details. Recognised by a brand, not `instanceof`, so a copy of this class loaded from another
 * path (a project's own `node_modules`) works the same.
 */
export class HookError extends Error {
  readonly details: Record<string, unknown> | undefined;
  readonly [HOOK_ERROR_BRAND] = true;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HookError';
    this.details = details;
  }
}

export const isHookError = (error: unknown): error is HookError =>
  typeof error === 'object' &&
  error !== null &&
  (error as Record<symbol, unknown>)[HOOK_ERROR_BRAND] === true;
