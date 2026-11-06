import type { Database } from '../db/index.js';
import type { SiteRef } from '../services/actorContext.js';
import { getPrimarySite } from '../services/sites.js';

/**
 * The primary site as top-level extension services see it. The primary can move to another site at any
 * time, from any process (the admin, the API, `shapio sites make-primary`), so every top-level read calls
 * `refresh` (one single-row read) and works on the site it returns. `current` is the primary as last read
 * in this process: what the synchronous `services.site` returns.
 */
export type PrimarySiteTracker = {
  /** The primary site as last read (at startup, or by the latest `refresh`). */
  current: () => SiteRef;
  /** Reads the primary site now and remembers it. */
  refresh: () => Promise<SiteRef>;
};

export const createPrimarySiteTracker = async (db: Database): Promise<PrimarySiteTracker> => {
  let current = await getPrimarySite(db);
  return {
    current: () => current,
    refresh: async () => {
      current = await getPrimarySite(db);
      return current;
    },
  };
};
