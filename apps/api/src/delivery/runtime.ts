import { resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { pino, type Logger } from 'pino';
import type { StorageConfig } from '../config/index.js';
import { describeDatabaseTarget, dialectOfUrl } from '../db/dialect.js';
import { clearDb, createDb, hasDb, setDb, type Database } from '../db/index.js';
import { createUrlBuilder } from '../helpers/publicUrl.js';
import { createMediaStorage } from '../media/storage.js';
import { createPermissionCache } from '../permissions/cache.js';
import { createPermissionEvaluator } from '../permissions/evaluator.js';
import type { PermissionEvaluator, TokenPrincipal } from '../permissions/types.js';
import * as systemSettingsRepository from '../repositories/systemSettings.js';
import { createSchemaFieldVisibility } from '../schema/fieldVisibility.js';
import { createSchemaRegistry, type SchemaRegistry } from '../schema/registry.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { parseDeliveryDescriptor, type DeliveryDescriptor } from '../services/deliveryDescriptor.js';
import { SIGNING_SECRET_SETTING } from '../services/signingSecret.js';
import { DeliveryRuntimeError } from './errors.js';

/**
 * In-process delivery (plan next-in-process §2): the delivery API's reads as function calls in the reading
 * process (a Next.js server, an SSR site, a script), with the server's permissions, shapes and schema. Only
 * the database URL is required: the server records its release and a delivery descriptor (public URL, media
 * locations) at every start, and every call reads both with its request state.
 */
export type DeliveryRuntimeOptions = {
  /** The Shapio database: a `postgres://` or `mysql://` URL. SQLite is single-process and refused. */
  databaseUrl: string;
  /** Pooled connections (default 4). Serverless functions: 1 or 2. `next build` opens one pool per worker. */
  poolMax?: number;
  /** How long a read waits for a pooled connection before it fails with 503 (default 10 s, as the server). */
  acquireTimeoutMs?: number;
  /**
   * Signs URLs of private media stored on the server's disk. Default: the secret the server generated and
   * stored; pass the server's SESSION_SECRET when it sets one.
   */
  signingSecret?: string;
  /** Presigns URLs of private media on S3. Default: the AWS SDK's own credential chain (environment, profile). */
  s3Credentials?: { accessKeyId: string; secretAccessKey: string };
  /**
   * When the server's release differs from this one: `throw` (default) a `ShapioVersionSkewError`, or `http`:
   * read through the HTTP API at `fallbackUrl` until the releases match again.
   */
  onVersionSkew?: 'throw' | 'http';
  /** The Shapio server's URL (with BASE_PATH) for `onVersionSkew: 'http'`. */
  fallbackUrl?: string;
  /** Where failures are logged (pino). Default: warnings and errors to stdout. */
  logger?: Logger;
};

/** Media dependencies for one stored descriptor (rebuilt only when the server's descriptor changes). */
type MediaDependencies = NonNullable<ContentServiceContext['media']>;

export type DeliveryRuntime = {
  readonly databaseUrl: string;
  readonly db: Database;
  readonly registry: SchemaRegistry;
  /** The unscoped evaluator; each call scopes it to its principal and versions (`permissions/scoped.ts`). */
  readonly permissions: PermissionEvaluator;
  readonly log: Logger;
  readonly onVersionSkew: 'throw' | 'http';
  readonly fallbackUrl: string | undefined;
  /** Resolved delivery tokens by token hash; each call still checks the token is live. */
  readonly tokens: Map<string, TokenPrincipal>;
  /** Media storage and URLs for the stored descriptor text. */
  mediaFor: (descriptor: string) => Promise<MediaDependencies>;
  /**
   * Registers one more user of this shared runtime (a local client); the returned function releases it, and
   * the last release closes the runtime.
   */
  retain: () => () => Promise<void>;
  /** Closes the pool now, whoever else uses it. The runtime cannot be used afterwards; a new one may be created. */
  close: () => Promise<void>;
};

/** One runtime per database per process, kept on `globalThis` so a re-evaluated module (dev reloads, a
 * bundler's second copy) never opens a second pool. */
const RUNTIMES = Symbol.for('shapio.delivery');

const runtimes = (): Map<string, DeliveryRuntime> => {
  const holder = globalThis as typeof globalThis & { [RUNTIMES]?: Map<string, DeliveryRuntime> };
  holder[RUNTIMES] ??= new Map();
  return holder[RUNTIMES];
};

const DEFAULT_POOL_MAX = 4;

/** Local media is never read from disk here; the adapter only builds URLs. Any file access fails loudly. */
const NO_LOCAL_MEDIA_ROOT = resolve('/', '.shapio-in-process-has-no-media');

const storageConfigOf = (
  descriptor: DeliveryDescriptor,
  credentials: DeliveryRuntimeOptions['s3Credentials'],
): StorageConfig => {
  const { s3 } = descriptor.media;
  return {
    driver: 'local',
    mediaPath: NO_LOCAL_MEDIA_ROOT,
    s3: s3
      ? {
          bucket: s3.bucket,
          region: s3.region ?? undefined,
          endpoint: s3.endpoint ?? undefined,
          forcePathStyle: s3.forcePathStyle,
          accessKeyId: credentials?.accessKeyId,
          secretAccessKey: credentials?.secretAccessKey,
        }
      : undefined,
    publicBaseUrl: descriptor.media.publicBaseUrl ?? undefined,
    maxUploadBytes: 0,
    allowedTypes: [],
  };
};

const assertSupported = (options: DeliveryRuntimeOptions) => {
  const dialect = dialectOfUrl(options.databaseUrl);
  if (dialect === 'sqlite') {
    throw new DeliveryRuntimeError(
      'In-process delivery needs PostgreSQL or MySQL: a SQLite database is served by one process only. ' +
        "Read over HTTP with @shapio/client's createClient instead",
    );
  }
  if (dialect === undefined) {
    throw new DeliveryRuntimeError('databaseUrl must be a postgres:// or mysql:// URL');
  }
  if (options.onVersionSkew === 'http' && !options.fallbackUrl) {
    throw new DeliveryRuntimeError("onVersionSkew: 'http' needs fallbackUrl, the Shapio server's URL");
  }
};

const openRuntime = (options: DeliveryRuntimeOptions): DeliveryRuntime => {
  const log = options.logger ?? pino({ level: 'warn' });
  const db = createDb({
    connectionString: options.databaseUrl,
    poolMax: options.poolMax ?? DEFAULT_POOL_MAX,
    ...(options.acquireTimeoutMs !== undefined ? { acquireTimeoutMs: options.acquireTimeoutMs } : {}),
    applicationName: 'shapio-in-process',
    onIdleConnectionError: (error) =>
      log.warn({ err: error }, 'database connection lost; it will be replaced on the next query'),
  });
  // Repositories default to the process handle. A Shapio server in this process keeps its own (same
  // database); otherwise this pool becomes it.
  const ownsProcessHandle = !hasDb();
  if (ownsProcessHandle) {
    setDb(db);
  }
  const registryLog = log.child({ component: 'schema-registry' }) as unknown as FastifyBaseLogger;
  const registry = createSchemaRegistry({ db, log: registryLog });
  const permissions = createPermissionEvaluator({
    grants: createPermissionCache(db),
    fields: createSchemaFieldVisibility(registry),
  });

  let media: { descriptor: string; dependencies: Promise<MediaDependencies> } | undefined;
  let users = 0;
  let closing: Promise<void> | undefined;
  const buildMedia = async (stored: string): Promise<MediaDependencies> => {
    const descriptor = parseDeliveryDescriptor(stored);
    const urls = createUrlBuilder(descriptor);
    const signingSecret =
      options.signingSecret ?? (await systemSettingsRepository.findValue(SIGNING_SECRET_SETTING, db));
    const storage = await createMediaStorage(storageConfigOf(descriptor, options.s3Credentials), {
      urls,
      ...(signingSecret !== undefined ? { signingSecret } : {}),
    });
    return { storage, urls };
  };

  const runtime: DeliveryRuntime = {
    databaseUrl: options.databaseUrl,
    db,
    registry,
    permissions,
    log,
    onVersionSkew: options.onVersionSkew ?? 'throw',
    fallbackUrl: options.fallbackUrl,
    tokens: new Map(),
    mediaFor: (descriptor) => {
      if (media?.descriptor !== descriptor) {
        const dependencies = buildMedia(descriptor);
        media = { descriptor, dependencies };
        // A failed build is retried by the next call instead of being cached.
        dependencies.catch(() => {
          if (media?.dependencies === dependencies) {
            media = undefined;
          }
        });
      }
      return media.dependencies;
    },
    retain: () => {
      users += 1;
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        users -= 1;
        if (users === 0) {
          await runtime.close();
        }
      };
    },
    close: () => {
      closing ??= (async () => {
        if (runtimes().get(options.databaseUrl) === runtime) {
          runtimes().delete(options.databaseUrl);
        }
        await registry.close();
        await db.destroy();
        if (ownsProcessHandle) {
          clearDb(db);
        }
      })();
      return closing;
    },
  };
  return runtime;
};

/**
 * The in-process delivery runtime for a database: created once per process and shared (the same URL returns
 * the same runtime; the first caller's options apply). A process reads one Shapio database: another URL is
 * refused. Nothing is read until the first call, so creating it never fails on a database that is down.
 */
export const createDeliveryRuntime = (options: DeliveryRuntimeOptions): DeliveryRuntime => {
  assertSupported(options);
  const all = runtimes();
  const existing = all.get(options.databaseUrl);
  if (existing) {
    return existing;
  }
  const [other] = all.keys();
  if (other !== undefined) {
    throw new DeliveryRuntimeError(
      `This process already reads ${describeDatabaseTarget(other)} in process; one Shapio database per process`,
    );
  }
  const created = openRuntime(options);
  all.set(options.databaseUrl, created);
  return created;
};
