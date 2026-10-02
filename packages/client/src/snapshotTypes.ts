/** Publication snapshots for delivery callers (`/api/snapshots`, apps/api/src/routes/snapshots). */
export type SnapshotChangeKind = 'published' | 'updated' | 'unpublished';

export type SnapshotChangesQuery = {
  from: number;
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
