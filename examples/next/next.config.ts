import { createClient } from '@shapio/client';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

/**
 * Pins one publication snapshot for the whole `next build`: Next renders pages in several worker processes, so
 * the snapshot is read here, once, before any page renders, and handed to every worker as SHAPIO_SNAPSHOT
 * (inlined into the build). A set SHAPIO_SNAPSHOT wins. `next dev` and `next start` do not read Shapio here.
 */
const pinSnapshot = async (): Promise<string> => {
  if (process.env.SHAPIO_SNAPSHOT) {
    return process.env.SHAPIO_SNAPSHOT;
  }
  const token = process.env.SHAPIO_DELIVERY_TOKEN;
  if (!token) {
    throw new Error('Set SHAPIO_DELIVERY_TOKEN to build the site; `npm run seed` writes one to .env');
  }
  const client = createClient({
    baseUrl: process.env.SHAPIO_URL || 'http://localhost:4300',
    token,
    site: process.env.SHAPIO_SITE || undefined,
  });
  const { snapshot } = await client.snapshots.current();
  return String(snapshot);
};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Only this site and Shapio may frame its pages (Shapio's preview pane shows /preview/ beside the document).
 * The origin comes from NEXT_PUBLIC_SHAPIO_URL, else SHAPIO_URL.
 */
const frameAncestors = () => {
  const shapio = originOf(
    process.env.NEXT_PUBLIC_SHAPIO_URL || process.env.SHAPIO_URL || 'http://localhost:4300',
  );
  return `frame-ancestors 'self'${shapio ? ` ${shapio}` : ''}`;
};

const nextConfig = async (phase: string): Promise<NextConfig> => ({
  trailingSlash: true,
  headers: async () => [
    { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: frameAncestors() }] },
  ],
  // The front page lives under its locale (`/en/`), as in the Astro and SvelteKit starters.
  redirects: async () => [{ source: '/', destination: '/en/', permanent: false }],
  env: {
    // The preview page calls Shapio from the browser: NEXT_PUBLIC_SHAPIO_URL, else SHAPIO_URL.
    NEXT_PUBLIC_SHAPIO_URL:
      process.env.NEXT_PUBLIC_SHAPIO_URL || process.env.SHAPIO_URL || 'http://localhost:4300',
    ...(phase === PHASE_PRODUCTION_BUILD ? { SHAPIO_SNAPSHOT: await pinSnapshot() } : {}),
  },
});

export default nextConfig;
