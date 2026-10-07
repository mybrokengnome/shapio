/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes):
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. A generic-webhook trigger carries it;
 *   without it the build pins the latest snapshot when it starts.
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 * - PUBLIC_SHAPIO_URL: the origin the browser calls for previews (defaults to SHAPIO_URL).
 * - SHAPIO_DRAFTS: `true` turns on drafts mode, for your development server: every read shows saved drafts
 *   instead of published content (no snapshot), and pages carry a "Drafts" badge. The token must be a delivery
 *   token whose role grants Read drafts: SHAPIO_DEV_DELIVERY_TOKEN when set (`npm run seed` writes one), else
 *   SHAPIO_DELIVERY_TOKEN. Never set it in a production environment.
 *
 * Settings come from `process.env` only (astro.config.mjs loads `.env` into it). Reading Vite's env object as a
 * whole instead would make Vite write every variable named in this file into the compiled code, so a changed
 * SHAPIO_SNAPSHOT would change the code Astro hashes and re-render every page (see src/lib/cacheKey.ts).
 */
const read = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

export const shapioUrl = () => read('SHAPIO_URL') ?? 'http://localhost:4300';

/** Drafts mode (SHAPIO_DRAFTS=true): the site reads saved drafts. Never set in production. */
export const isDraftsMode = () => read('SHAPIO_DRAFTS') === 'true';

export const deliveryToken = () => {
  // Drafts mode reads with the development token (Read drafts) when there is one.
  const token =
    (isDraftsMode() ? read('SHAPIO_DEV_DELIVERY_TOKEN') : undefined) ?? read('SHAPIO_DELIVERY_TOKEN');
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

type ViteImportMeta = ImportMeta & { env: { DEV?: boolean } };

/**
 * True under `astro dev`; false in builds and in the scripts. Written out in full (`import.meta.env.DEV`) so Vite
 * replaces it with a constant; outside Vite (the scripts, run by Node) there is no env object, which is the
 * TypeError caught here, and that is not dev.
 */
export const isDev = (): boolean => {
  try {
    return (import.meta as ViteImportMeta).env.DEV === true;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
};
