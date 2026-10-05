import {
  PUBLIC_SHAPIO_URL,
  SHAPIO_DELIVERY_TOKEN,
  SHAPIO_DEV_DELIVERY_TOKEN,
  SHAPIO_DRAFTS,
  SHAPIO_SITE,
  SHAPIO_SNAPSHOT,
  SHAPIO_URL,
  SITE_URL,
} from '$app/env/private';

/**
 * Build-time settings, from the environment (or `.env` in this folder, which `npm run seed` writes), declared
 * in src/env.ts:
 * - SHAPIO_URL: the Shapio origin (with BASE_PATH), e.g. https://cms.example.com.
 * - SHAPIO_DELIVERY_TOKEN: a read-only delivery token (Settings → API tokens, delivery role).
 * - SHAPIO_SNAPSHOT: optional; the publication snapshot to build. Without it the build pins the latest
 *   snapshot when prerendering starts, so every page shows the same moment.
 * - SHAPIO_SITE: optional; the site key on a multi-site Shapio (default: the token's site, else the primary).
 * - PUBLIC_SHAPIO_URL: the Shapio URL the browser calls for previews (defaults to SHAPIO_URL).
 * - SITE_URL: optional; this site's public origin, e.g. https://www.example.com. Pages then carry a canonical
 *   URL (and `og:url`) unless the entry sets its own.
 * - SHAPIO_DRAFTS: `true` turns on drafts mode, for your development server: every read shows saved drafts
 *   instead of published content (no snapshot), and pages carry a "Drafts" badge. The token must be a delivery
 *   token whose role grants Read drafts: SHAPIO_DEV_DELIVERY_TOKEN when set (`npm run seed` writes one), else
 *   SHAPIO_DELIVERY_TOKEN. Never set it in a production environment.
 */
export const shapioUrl = () => SHAPIO_URL ?? 'http://localhost:4300';

/** Handed to the preview page at build time: the URL its browser code reads drafts from. */
export const publicShapioUrl = () => PUBLIC_SHAPIO_URL ?? shapioUrl();

/** Drafts mode (SHAPIO_DRAFTS=true): the site reads saved drafts. Never set in production. */
export const isDraftsMode = () => SHAPIO_DRAFTS === 'true';

export const deliveryToken = () => {
  // Drafts mode reads with the development token (Read drafts) when there is one.
  const token = (isDraftsMode() ? SHAPIO_DEV_DELIVERY_TOKEN : undefined) ?? SHAPIO_DELIVERY_TOKEN;
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

export const siteUrl = () => SITE_URL;
