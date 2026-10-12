import type { EntryHistory, EntryPublication } from '@shapio/client';

export type HistoryRevision = EntryHistory['items'][number];

/** One row of an entry's history: a revision, or a publication going live or ending. */
export type HistoryRow =
  | { kind: 'revision'; key: string; at: string; revision: HistoryRevision; live: boolean }
  | { kind: 'published' | 'unpublished'; key: string; at: string; publication: EntryPublication };

/** Within the same instant, the later step of a write first: unpublish, publish, then the revision saved. */
const KIND_ORDER = { unpublished: 0, published: 1, revision: 2 } as const;

export const revisionRowKey = (revisionId: string) => `revision:${revisionId}`;

/**
 * Revisions and publications as one list, newest first. A revision that is live now is marked; a publication
 * that ended without being replaced adds an "unpublished" row.
 */
export const historyTimeline = ({ items, publications }: EntryHistory): HistoryRow[] => {
  const liveIds = new Set(publications.filter((item) => item.live).map((item) => item.revisionId));
  const rows: HistoryRow[] = [
    ...items.map((revision) => ({
      kind: 'revision' as const,
      key: revisionRowKey(revision.id),
      at: revision.createdAt,
      revision,
      live: liveIds.has(revision.id),
    })),
    ...publications.flatMap((publication, index) => {
      const published: HistoryRow = {
        kind: 'published',
        key: `published:${index}`,
        at: publication.publishedAt,
        publication,
      };
      return publication.unpublishedAt
        ? [
            published,
            {
              kind: 'unpublished' as const,
              key: `unpublished:${index}`,
              at: publication.unpublishedAt,
              publication,
            },
          ]
        : [published];
    }),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
};
