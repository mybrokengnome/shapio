import { SHAPIO_DELIVERY_TOKEN, SHAPIO_SITE, SHAPIO_SNAPSHOT, SHAPIO_URL } from '$app/env/private';

/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes), declared
 * in src/env.ts:
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. Without it the build pins the latest
 *   snapshot when prerendering starts, so every page shows the same moment.
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 */
export const shapioUrl = () => SHAPIO_URL ?? 'http://localhost:4300';

export const deliveryToken = () => {
  const token = SHAPIO_DELIVERY_TOKEN;
  if (!token) {
    throw new Error(
      'Set SHAPIO_DELIVERY_TOKEN (a Shapio delivery token) to build the site; `npm run seed` writes one to .env',
    );
  }
  return token;
};

export const siteKey = () => SHAPIO_SITE;

export const configuredSnapshot = (): number | undefined => {
  const value = SHAPIO_SNAPSHOT;
  if (value === undefined) {
    return undefined;
  }
  const snapshot = Number(value);
  if (!Number.isInteger(snapshot) || snapshot < 0) {
    throw new Error(`SHAPIO_SNAPSHOT must be a publication snapshot number, got "${value}"`);
  }
  return snapshot;
};
