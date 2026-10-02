import type { SnapshotChange, SnapshotChangeKind } from '@shapio/client';

/** How a card moved between the snapshot before and this one. */
export type CardMark = 'unchanged' | 'added' | 'changed' | 'removed';

/** One entry as delivery served it at a snapshot, in one locale (after fallback). */
export type LiveItem = { id: string; locale: string; title: string | null; coverUrl: string | null };

export type TimelineCard = {
  id: string;
  title: string | null;
  coverUrl: string | null;
  /** Locales the entry is live in at this snapshot (a removed card: the ones it was live in). */
  locales: string[];
  mark: CardMark;
  /** Revision per locale, where the diff names it (changed, added, removed locales). */
  revisionIds: Record<string, string>;
};

const markOf = (kinds: readonly SnapshotChangeKind[], live: boolean): CardMark => {
  if (!live) {
    return 'removed';
  }
  if (kinds.length > 0 && kinds.every((kind) => kind === 'published')) {
    return 'added';
  }
  return kinds.length > 0 ? 'changed' : 'unchanged';
};

/**
 * One place's cards at a snapshot: every entry live there (merged across locales), marked against the
 * snapshot before from the diff between the two; entries the diff unpublished and that are no longer live
 * come back as `removed` cards described by the diff. Live cards keep the order delivery served them in;
 * removed ones follow.
 */
export const buildCards = (live: readonly LiveItem[], changes: readonly SnapshotChange[]): TimelineCard[] => {
  const byId = new Map<string, TimelineCard>();
  for (const item of live) {
    const card = byId.get(item.id);
    if (card) {
      if (!card.locales.includes(item.locale)) {
        card.locales.push(item.locale);
      }
      card.title ??= item.title;
      card.coverUrl ??= item.coverUrl;
      continue;
    }
    byId.set(item.id, {
      id: item.id,
      title: item.title,
      coverUrl: item.coverUrl,
      locales: [item.locale],
      mark: 'unchanged',
      revisionIds: {},
    });
  }
  const removed: TimelineCard[] = [];
  for (const change of changes) {
    const card = byId.get(change.id);
    const revisionIds = Object.fromEntries(
      change.locales.flatMap(({ locale, revisionId }) => (revisionId ? [[locale, revisionId]] : [])),
    );
    const mark = markOf(
      change.locales.map(({ change: kind }) => kind),
      card !== undefined,
    );
    if (card) {
      card.mark = mark;
      card.revisionIds = revisionIds;
      card.title ??= change.title;
    } else if (mark === 'removed') {
      removed.push({
        id: change.id,
        title: change.title,
        coverUrl: null,
        locales: change.locales.map(({ locale }) => locale),
        mark,
        revisionIds,
      });
    }
  }
  return [...byId.values(), ...removed];
};

/** Every `step`-th snapshot gets a tick, so a long ledger keeps at most `maxTicks` of them. */
export const tickStep = (count: number, maxTicks = 60): number =>
  count <= maxTicks ? 1 : Math.ceil(count / maxTicks);
