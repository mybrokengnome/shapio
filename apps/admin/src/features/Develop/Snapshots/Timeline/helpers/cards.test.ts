import type { SnapshotChange } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { buildCards, tickStep, type LiveItem } from './cards';

const live = (id: string, locale = 'en', title: string | null = id): LiveItem => ({
  id,
  locale,
  title,
  coverUrl: null,
});

const change = (
  id: string,
  locales: Array<[string, 'published' | 'updated' | 'unpublished']>,
): SnapshotChange => ({
  id,
  modelId: 'model',
  modelKey: 'article',
  routeKey: 'articles',
  title: `${id} title`,
  coverMediaId: null,
  locales: locales.map(([locale, kind]) => ({ locale, change: kind, revisionId: `${id}-${locale}` })),
});

describe('buildCards', () => {
  it('merges locales and leaves entries the diff does not name unchanged', () => {
    const cards = buildCards([live('a'), live('a', 'fr'), live('b')], []);
    expect(cards.map(({ id, locales, mark }) => ({ id, locales, mark }))).toEqual([
      { id: 'a', locales: ['en', 'fr'], mark: 'unchanged' },
      { id: 'b', locales: ['en'], mark: 'unchanged' },
    ]);
  });

  it('marks newly published entries added and republished or partly unpublished ones changed', () => {
    const cards = buildCards(
      [live('a'), live('b'), live('c')],
      [
        change('a', [['en', 'published']]),
        change('b', [['en', 'updated']]),
        change('c', [['fr', 'unpublished']]),
      ],
    );
    expect(cards.map(({ id, mark }) => [id, mark])).toEqual([
      ['a', 'added'],
      ['b', 'changed'],
      ['c', 'changed'],
    ]);
    expect(cards[1]?.revisionIds).toEqual({ en: 'b-en' });
  });

  it('adds entries that are no longer live as removed cards, named by the diff', () => {
    const cards = buildCards([live('a')], [change('gone', [['en', 'unpublished']])]);
    expect(cards.at(-1)).toEqual({
      id: 'gone',
      title: 'gone title',
      coverUrl: null,
      locales: ['en'],
      mark: 'removed',
      revisionIds: { en: 'gone-en' },
    });
  });

  it('keeps a live title over the diff title and fills a missing one from it', () => {
    const cards = buildCards(
      [live('a', 'en', null), live('b')],
      [change('a', [['en', 'updated']]), change('b', [['en', 'updated']])],
    );
    expect(cards.map((card) => card.title)).toEqual(['a title', 'b']);
  });
});

describe('tickStep', () => {
  it('ticks every snapshot up to the limit, then every k-th', () => {
    expect(tickStep(10)).toBe(1);
    expect(tickStep(60)).toBe(1);
    expect(tickStep(61)).toBe(2);
    expect(tickStep(600)).toBe(10);
  });
});
