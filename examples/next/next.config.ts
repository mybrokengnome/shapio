import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { createShapioClient } from './src/lib/shapioClient';

/**
 * Pins one publication snapshot for the whole `next build`: Next renders pages in several worker processes, so
 * the snapshot is read here, once, before any page renders, and handed to every worker as SHAPIO_SNAPSHOT
 * (inlined into the build). A set SHAPIO_SNAPSHOT wins and pins the site for good; otherwise `next start` moves
 * forward from this snapshot as Shapio's webhook calls /api/revalidate (src/lib/liveSnapshot.ts). `next dev` and
 * `next start` do not read Shapio here. Drafts mode (SHAPIO_DRAFTS=true) pins nothing: drafts have no snapshot.
 */
const pinSnapshot = async (): Promise<string> => {
  if (process.env.SHAPIO_SNAPSHOT) {
    return process.env.SHAPIO_SNAPSHOT;
  }
  if (process.env.SHAPIO_DRAFTS === 'true') {
    return '';
  }
  // Over HTTP or in process, as the pages read (SHAPIO_MODE).
  const client = createShapioClient();
  try {
    const { snapshot } = await client.snapshots.current();
    return String(snapshot);
  } finally {
    // An in-process client holds database connections; this process has no further use for them.
    await client.close?.();
  }
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
  // SHAPIO_MODE=in-process: loaded from node_modules once per server process (one database pool), not
  // bundled into every route.
  serverExternalPackages: ['@shapio/local'],
  headers: async () => [
    { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: frameAncestors() }] },
  ],
  // The front page lives under its locale (`/en/`), as in the Astro and SvelteKit starters.
  redirects: async () => [{ source: '/', destination: '/en/', permanent: false }],
  env: {
    // The preview page calls Shapio from the browser: NEXT_PUBLIC_SHAPIO_URL, else SHAPIO_URL.
    NEXT_PUBLIC_SHAPIO_URL:
      process.env.NEXT_PUBLIC_SHAPIO_URL || process.env.SHAPIO_URL || 'http://localhost:4300',
    ...(phase === PHASE_PRODUCTION_BUILD
      ? {
          SHAPIO_SNAPSHOT: await pinSnapshot(),
          // A snapshot set by hand stays the site's snapshot under `next start`: /api/revalidate does nothing.
          SHAPIO_SNAPSHOT_PINNED: process.env.SHAPIO_SNAPSHOT ? 'true' : 'false',
        }
      : {}),
  },
});

export default nextConfig;
