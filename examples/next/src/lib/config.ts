/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes):
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. Without it, next.config.ts pins the latest
 *   snapshot once when `next build` starts, so every page of the build shows the same moment.
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 * - NEXT_PUBLIC_SHAPIO_URL: the Shapio URL the browser calls for previews (defaults to SHAPIO_URL; inlined into
 *   the client bundle at build time).
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

/** The Shapio URL the preview page calls from the browser. Spelled out so Next inlines it into the client. */
export const publicShapioUrl = () => process.env.NEXT_PUBLIC_SHAPIO_URL || 'http://localhost:4300';
