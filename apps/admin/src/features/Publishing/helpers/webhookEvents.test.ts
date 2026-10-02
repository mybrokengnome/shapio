import { describe, expect, it } from 'vitest';
import { groupEvents, groupPattern, toggleEvent, toggleGroup } from './webhookEvents';

const CATALOGUE = [
  { type: 'entry.published', group: 'entry' },
  { type: 'change_set.shipped', group: 'change_set' },
  { type: 'entry.unpublished', group: 'entry' },
];

describe('webhook event selection', () => {
  it('groups the catalogue in order', () => {
    expect(groupEvents(CATALOGUE)).toEqual([
      { group: 'entry', types: ['entry.published', 'entry.unpublished'] },
      { group: 'change_set', types: ['change_set.shipped'] },
    ]);
  });

  it('replaces a group’s types with its pattern, and removes it again', () => {
    const [entry] = groupEvents(CATALOGUE);
    if (!entry) {
      throw new Error('missing group');
    }
    const selected = toggleGroup(['entry.published', 'change_set.shipped'], entry, true);
    expect(selected).toEqual(['change_set.shipped', groupPattern('entry')]);
    expect(toggleGroup(selected, entry, false)).toEqual(['change_set.shipped']);
  });

  it('toggles single types without duplicates', () => {
    expect(toggleEvent(['a'], 'a', true)).toEqual(['a']);
    expect(toggleEvent(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});
