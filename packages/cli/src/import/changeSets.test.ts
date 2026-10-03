import type { ShapioClient } from '@shapio/client';
import { describe, expect, it, vi } from 'vitest';
import { addToChangeSets, changeSetUrl, MAX_ITEMS_PER_SET, type PublishItem } from './changeSets.js';
import { emptyState, type ImportMap } from './importMap.js';

const fakeClient = () => {
  const sets = new Map<string, { status: string; entryItemCount: number }>();
  const create = vi.fn(({ title }: { title: string }) => {
    const id = `set-${sets.size + 1}`;
    sets.set(id, { status: 'open', entryItemCount: 0 });
    return Promise.resolve({ id, title });
  });
  const addEntry = vi.fn((id: string) => {
    sets.get(id)!.entryItemCount += 1;
    return Promise.resolve({});
  });
  const get = vi.fn((id: string) => Promise.resolve({ id, ...sets.get(id)! }));
  const client = { admin: { changeSets: { create, addEntry, get } } } as unknown as ShapioClient;
  return { client, create, addEntry, sets };
};

const items = (count: number, offset = 0): PublishItem[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `e${index + offset}/`,
    modelKey: 'post',
    entryId: `e${index + offset}`,
    locale: null,
  }));

const emptyMap = (): ImportMap => ({
  format: 'shapio-import-map',
  formatVersion: 1,
  source: { kind: 'wordpress', path: '/x.xml', sha256: '' },
  plannedAt: '',
  definitions: {},
  media: {},
  entries: {},
  state: emptyState(),
});

describe('addToChangeSets', () => {
  it('opens numbered sets above the per-set limit', async () => {
    const { client, create } = fakeClient();
    const map = emptyMap();
    const total = MAX_ITEMS_PER_SET + 5;
    const outcome = await addToChangeSets(client, map, items(total), {
      label: 'WordPress',
      total,
      save: async () => {},
    });
    expect(outcome).toEqual({ added: total, failed: [] });
    expect(create.mock.calls.map(([input]) => input.title)).toEqual([
      'Import from WordPress (1/2)',
      'Import from WordPress (2/2)',
    ]);
    expect(Object.values(map.state.changeSetItems).filter((id) => id === 'set-2')).toHaveLength(5);
  });

  it('keeps filling the last open set on a re-run, with one unnumbered set for small imports', async () => {
    const { client, create } = fakeClient();
    const map = emptyMap();
    await addToChangeSets(client, map, items(3), { label: 'Strapi', total: 5, save: async () => {} });
    await addToChangeSets(client, map, items(2, 3), { label: 'Strapi', total: 5, save: async () => {} });
    expect(create.mock.calls.map(([input]) => input.title)).toEqual(['Import from Strapi']);
    expect(map.state.changeSets).toEqual([{ id: 'set-1', title: 'Import from Strapi' }]);
  });

  it('opens a new set when the last one was shipped', async () => {
    const { client, create, sets } = fakeClient();
    const map = emptyMap();
    await addToChangeSets(client, map, items(1), { label: 'Strapi', total: 2, save: async () => {} });
    sets.get('set-1')!.status = 'shipped';
    await addToChangeSets(client, map, items(1, 1), { label: 'Strapi', total: 2, save: async () => {} });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('changeSetUrl', () => {
  it('links the admin page, under the site when one is named', () => {
    expect(changeSetUrl('https://cms.test/base/', 'abc', null)).toBe(
      'https://cms.test/base/admin/changes/abc',
    );
    expect(changeSetUrl('https://cms.test', 'abc', 'blog')).toBe('https://cms.test/admin/s/blog/changes/abc');
  });
});
