import type { ShapioApiError } from '@shapio/client';
import type { Logger } from 'pino';

/**
 * The public types of `@shapio/local`, declared here so its declaration files stand alone (the runtime is
 * bundled from `@shapio/cms` source, whose types are not part of this package). `typeChecks.ts` keeps them
 * identical to the runtime's own.
 */
export type LocalClientOptions = {
  /** The Shapio database: a `postgres://` or `mysql://` URL. SQLite is single-process and refused. */
  databaseUrl: string;
  /** A delivery API token; without one, reads are anonymous (the site's `public` role). */
  token?: string;
  /** The site key; default the token's site, else the primary site. */
  site?: string;
  /** Pooled connections (default 4). Serverless functions: 1 or 2. `next build` opens one pool per worker. */
  poolMax?: number;
  /** How long a read waits for a pooled connection before it fails with 503 (default 10 s). */
  acquireTimeoutMs?: number;
  /**
   * Signs URLs of private media stored on the server's disk. Default: the secret the server generated and
   * stored; pass the server's SESSION_SECRET when it sets one.
   */
  signingSecret?: string;
  /** Presigns URLs of private media on S3. Default: the AWS SDK's own credential chain. */
  s3Credentials?: { accessKeyId: string; secretAccessKey: string };
  /**
   * When the server runs another Shapio release: `throw` (default) a `ShapioVersionSkewError`, or `http`: read
   * through the HTTP API at `fallbackUrl` until the releases match again.
   */
  onVersionSkew?: 'throw' | 'http';
  /** The Shapio server's URL (with BASE_PATH), for `onVersionSkew: 'http'`. */
  fallbackUrl?: string;
  /** Where failures are logged (pino). Default: warnings and errors to stdout. */
  logger?: Logger;
  /**
   * Drafts mode, for a site's development server: every delivery read asks for drafts instead of published
   * content (as `@shapio/client`'s `drafts`). Needs a delivery token whose role grants Read drafts; never set
   * it on a production build.
   */
  drafts?: boolean;
};

/** The server runs another Shapio release (503 `VERSION_SKEW`); null when the database predates this one. */
export type ShapioVersionSkewError = ShapioApiError & {
  readonly serverRelease: string | null;
  readonly libraryRelease: string;
};

/** A local client cannot be created for these options (SQLite, an unknown URL, a second database). */
export type DeliveryRuntimeError = Error;
