/** Publication snapshots for delivery callers (`/api/snapshots`, apps/api/src/routes/snapshots). */
export type SnapshotChangeKind = 'published' | 'updated' | 'unpublished';

/** Pass exactly one of `from` and `recent`. */
export type SnapshotChangesQuery = {
  /** The snapshot to compare from (your last build's). */
  from?: number;
  /**
   * Instead of `from`: start where the diff covers the last N entries (1–100) you may read that went live or
   * were updated and are still live; the page's `from` says where that was.
   */
  recent?: number;
  /** Defaults to the current snapshot. */
  to?: number;
  /** `nextCursor` of the previous page. */
  after?: string;
  /** Entries per page (default 100, at most 500). */
  limit?: number;
};

export type SnapshotChange = {
  id: string;
  modelId: string;
  /** The model's API ID. */
  modelKey: string;
  /** The delivery route key (`/api/content/<routeKey>`). */
  routeKey: string;
  /** From the revision live at `to` (at `from` when unpublished); null without a readable title. */
  title: string | null;
  /** The cover image's media asset ID, when the model has a readable cover. */
  coverMediaId: string | null;
  /** The plurals of the interfaces the entry's type implements, inherited ones included (`[]` when none). */
  interfaces: string[];
  locales: Array<{
    locale: string;
    change: SnapshotChangeKind;
    /** The revision live at `to`, or at `from` for `unpublished`. */
    revisionId: string | null;
  }>;
};

export type SnapshotChangesPage = {
  from: number;
  to: number;
  /** Schema version recorded with each end; when they differ, rebuild the affected models. */
  schemaVersions: { from: number | null; to: number | null };
  items: SnapshotChange[];
  nextCursor: string | null;
};

export type CurrentSnapshot = {
  snapshot: number;
  schemaVersion: number;
  publishedAt: string | null;
};
