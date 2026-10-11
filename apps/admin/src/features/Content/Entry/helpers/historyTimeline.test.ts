import type { EntryPublication } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { historyTimeline, type HistoryRevision } from './historyTimeline';

const revision = (id: string, reason: string, createdAt: string): HistoryRevision => ({
  id,
  locale: 'en',
  reason,
  schemaRevisionId: 's1',
  authorType: 'admin',
  authorId: 'a1',
  authorName: 'Ada Owner',
  parentRevisionId: null,
  createdAt,
});

const publication = (overrides: Partial<EntryPublication>): EntryPublication => ({
  revisionId: 'r1',
  locale: 'en',
  publishedAt: '2026-10-11T10:00:00.000Z',
  publishedBy: 'Ada Owner',
  via: null,
  changeSetTitle: null,
  live: false,
  unpublishedAt: null,
  unpublishedBy: null,
  ...overrides,
});

describe('historyTimeline', () => {
  it('interleaves publications with revisions, newest first, and marks the live revision', () => {
    const rows = historyTimeline({
      items: [
        revision('r2', 'save', '2026-10-11T11:00:00.000Z'),
        revision('r1', 'create', '2026-10-11T09:00:00.000Z'),
      ],
      publications: [
        publication({ revisionId: 'r2', publishedAt: '2026-10-11T12:00:00.000Z', live: true }),
        publication({ revisionId: 'r1', publishedAt: '2026-10-11T10:00:00.000Z' }),
      ],
    });
    expect(rows.map((row) => row.kind)).toEqual(['published', 'revision', 'published', 'revision']);
    expect(rows.map((row) => (row.kind === 'revision' ? row.live : null))).toEqual([null, true, null, false]);
  });

  it('adds an unpublished row when a publication ended without a replacement', () => {
    const rows = historyTimeline({
      items: [revision('r1', 'create', '2026-10-11T09:00:00.000Z')],
      publications: [publication({ unpublishedAt: '2026-10-11T13:00:00.000Z', unpublishedBy: 'Sam' })],
    });
    expect(rows.map((row) => row.kind)).toEqual(['unpublished', 'published', 'revision']);
    expect(rows[2]).toMatchObject({ kind: 'revision', live: false });
  });

  it('puts a publication above the revision it published in the same instant', () => {
    const at = '2026-10-11T09:00:00.000Z';
    const rows = historyTimeline({
      items: [revision('r1', 'create', at)],
      publications: [publication({ publishedAt: at, live: true })],
    });
    expect(rows.map((row) => row.kind)).toEqual(['published', 'revision']);
  });
});
