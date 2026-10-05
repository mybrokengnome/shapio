import { pinnedSnapshot } from '../lib/shapio.js';
import { LOCALES } from '../lib/site.js';

/**
 * `/build.json`: which publication snapshot this build shows (for checks and deployment debugging); null in
 * drafts mode, which shows saved drafts.
 */
export const GET = async () =>
  new Response(
    JSON.stringify({
      snapshot: (await pinnedSnapshot()) ?? null,
      locales: LOCALES,
      builtAt: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
