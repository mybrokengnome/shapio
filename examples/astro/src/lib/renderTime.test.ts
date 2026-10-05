import { describe, expect, it, vi } from 'vitest';
import { findBySlug, renderTimeEntry } from './renderTime.js';

describe('renderTimeEntry', () => {
  it('renders the getStaticPaths props in a build, without reading', async () => {
    const read = vi.fn();
    expect(await renderTimeEntry({ dev: false, props: { slug: 'about' }, read })).toEqual({ slug: 'about' });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the entry when it renders in dev, over stale props', async () => {
    const read = vi.fn().mockResolvedValue({ slug: 'about', title: 'New' });
    expect(await renderTimeEntry({ dev: true, props: { slug: 'about', title: 'Old' }, read })).toEqual({
      slug: 'about',
      title: 'New',
    });
  });

  it('is undefined in dev when the entry is gone, so the page answers 404', async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    expect(await renderTimeEntry({ dev: true, props: { slug: 'about' }, read })).toBeUndefined();
  });
});

describe('findBySlug', () => {
  it('finds the entry with the slug, or nothing', () => {
    const entries = [{ slug: 'home' }, { slug: 'about' }];
    expect(findBySlug(entries, 'about')).toBe(entries[1]);
    expect(findBySlug(entries, 'gone')).toBeUndefined();
  });
});
