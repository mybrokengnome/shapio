/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes):
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. Without it, next.config.ts pins the latest
 *   snapshot once when `next build` starts, so every page of the build shows the same moment. When set, the
 *   site stays at that snapshot under `next start` too (on-demand revalidation is off).
 * - SHAPIO_WEBHOOK_SECRET: the signing secret of the Shapio webhook that calls /api/revalidate (runtime only;
 *   `npm run seed` writes it).
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 * - SITE_URL: optional; this site's public origin, e.g. https://www.example.com. Pages then carry a canonical
 *   URL (and `og:url`) unless the entry sets its own.
 * - NEXT_PUBLIC_SHAPIO_URL: the Shapio URL the browser calls for previews (defaults to SHAPIO_URL; inlined into
 *   the client bundle at build time).
 * - SHAPIO_MODE: `http` (default) reads Shapio's delivery API over HTTP; `in-process` reads the same API as
 *   function calls in this server process (@shapio/local), from Shapio's database at DATABASE_URL. Previews
 *   and the browser still use SHAPIO_URL. See documentation/in-process.md.
 * - DATABASE_URL: Shapio's own database (PostgreSQL or MySQL), for SHAPIO_MODE=in-process only.
 */
const read = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

export const shapioUrl = () => read('SHAPIO_URL') ?? 'http://localhost:4300';

export const deliveryToken = () => {
  const token = read('SHAPIO_DELIVERY_TOKEN');
  if (!token) {
    throw new Error(
      'Set SHAPIO_DELIVERY_TOKEN (a Shapio delivery token) to build the site; `npm run seed` writes one to .env',
    );
  }
  return token;
};

export const siteKey = () => read('SHAPIO_SITE');

export type ShapioMode = 'http' | 'in-process';

export const shapioMode = (): ShapioMode => {
  const mode = read('SHAPIO_MODE') ?? 'http';
  if (mode !== 'http' && mode !== 'in-process') {
    throw new Error(`SHAPIO_MODE must be "http" or "in-process", got "${mode}"`);
  }
  return mode;
};

export const databaseUrl = () => {
  const url = read('DATABASE_URL');
  if (!url) {
    throw new Error("SHAPIO_MODE=in-process reads Shapio's database: set DATABASE_URL to it");
  }
  return url;
};

export const siteUrl = () => read('SITE_URL');

export const configuredSnapshot = (): number | undefined => {
  // Spelled out (not read(name)): next.config.ts hands the pinned snapshot over through Next's `env`, which
  // replaces this exact expression at build time.
  const value = process.env.SHAPIO_SNAPSHOT;
  if (value === undefined || value === '') {
    return undefined;
  }
  const snapshot = Number(value);
  if (!Number.isInteger(snapshot) || snapshot < 0) {
    throw new Error(`SHAPIO_SNAPSHOT must be a publication snapshot number, got "${value}"`);
  }
  return snapshot;
};

/**
 * True when the build was pinned with SHAPIO_SNAPSHOT (next.config.ts records it): the site then keeps
 * showing that snapshot and /api/revalidate does nothing. Spelled out so Next inlines it at build time.
 */
export const isSnapshotPinned = () => process.env.SHAPIO_SNAPSHOT_PINNED === 'true';

/** The secret /api/revalidate checks webhook signatures with; undefined when it is not set. */
export const webhookSecret = () => read('SHAPIO_WEBHOOK_SECRET');

/** The Shapio URL the preview page calls from the browser. Spelled out so Next inlines it into the client. */
export const publicShapioUrl = () => process.env.NEXT_PUBLIC_SHAPIO_URL || 'http://localhost:4300';
