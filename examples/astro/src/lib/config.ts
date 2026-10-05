/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes):
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. A generic-webhook trigger carries it;
 *   without it the build pins the latest snapshot when it starts.
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 * - PUBLIC_SHAPIO_URL: the origin the browser calls for previews (defaults to SHAPIO_URL).
 */
const read = (name: string): string | undefined => {
  const fromVite = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  const value = fromVite ?? process.env[name];
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

export const configuredSnapshot = (): number | undefined => {
  const value = read('SHAPIO_SNAPSHOT');
  if (value === undefined) {
    return undefined;
  }
  const snapshot = Number(value);
  if (!Number.isInteger(snapshot) || snapshot < 0) {
    throw new Error(`SHAPIO_SNAPSHOT must be a publication snapshot number, got "${value}"`);
  }
  return snapshot;
};

export const publicShapioUrl = () => read('PUBLIC_SHAPIO_URL') ?? shapioUrl();

export const siteKey = () => read('SHAPIO_SITE');

/** True under `astro dev` (Vite's import.meta.env.DEV); false in builds and in the scripts. */
export const isDev = () => (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
