// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readRecentItems,
  RECENT_LIMIT,
  RECENT_STORAGE_KEY,
  rememberRecentItem,
  type RecentItem,
} from './recentItems';

const item = (id: string): RecentItem => ({ id, label: id, group: 'goto', link: { to: '/media' } });

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('recent palette items', () => {
  it('remembers the newest first, without duplicates, up to the limit', () => {
    for (let index = 0; index < RECENT_LIMIT + 2; index += 1) {
      rememberRecentItem(item(`item-${index}`));
    }
    rememberRecentItem(item('item-3'));
    const ids = readRecentItems().map(({ id }) => id);
    expect(ids[0]).toBe('item-3');
    expect(ids).toHaveLength(RECENT_LIMIT);
    expect(new Set(ids).size).toBe(RECENT_LIMIT);
  });

  it('ignores corrupt storage', () => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, '{not json');
    expect(readRecentItems()).toEqual([]);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify([{ id: 1 }, item('ok')]));
    expect(readRecentItems().map(({ id }) => id)).toEqual(['ok']);
  });

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecentItems()).toEqual([]);
    expect(rememberRecentItem(item('a')).map(({ id }) => id)).toEqual(['a']);
  });
});
