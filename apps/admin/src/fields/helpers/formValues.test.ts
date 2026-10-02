import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../packages/schema/src/testing/fixtures';
import {
  buildPatch,
  dirtyKeysOf,
  mergeSaved,
  newComponentItem,
  toFormValues,
  toInputValue,
} from './formValues';
import { CLIENT_KEY, isSameContent, stripClientKeys } from './values';

const hero = component({
  apiKey: 'hero',
  label: 'Hero',
  fields: [field({ apiKey: 'heading' }), field({ apiKey: 'image', type: 'media' })],
});
const page = model({
  fields: [
    field({ apiKey: 'title' }),
    field({ apiKey: 'cover', type: 'media' }),
    field({ apiKey: 'gallery', type: 'media', settings: { multiple: true } }),
    field({ apiKey: 'hero', type: 'component', settings: { component: hero.id } }),
    field({ apiKey: 'sections', type: 'dynamiczone', settings: { components: [hero.id] } }),
    field({ apiKey: 'old', deprecated: true }),
  ],
});
const components = new Map([[hero.id, hero]]);
const asset = (id: string) => ({ id, url: `https://cdn.test/${id}.png`, filename: `${id}.png` });

describe('toFormValues', () => {
  it('turns media views into IDs (collecting the views), keys list items, and drops deprecated fields', () => {
    const seen: string[] = [];
    const values = toFormValues(
      page.fields,
      {
        title: 'Home',
        cover: asset('a1'),
        gallery: [asset('a2'), asset('a3')],
        hero: { heading: 'Hi', image: asset('a4') },
        sections: [{ __component: 'hero', heading: 'One', image: null }],
        old: 'kept on the server',
      },
      components,
      (view) => seen.push(view.id),
    );
    expect(seen).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(stripClientKeys(values)).toEqual({
      title: 'Home',
      cover: 'a1',
      gallery: ['a2', 'a3'],
      hero: { heading: 'Hi', image: 'a4' },
      sections: [{ __component: 'hero', heading: 'One', image: null }],
    });
    expect(values.hero).toHaveProperty(CLIENT_KEY);
    expect((values.sections as Record<string, unknown>[])[0]).toHaveProperty(CLIENT_KEY);
  });
});

describe('patches', () => {
  it('sends only changed fields, without client keys, clearing emptied ones with null', () => {
    const baseline = toFormValues(
      page.fields,
      { title: 'Home', cover: 'a1', hero: { heading: 'Hi' } },
      components,
    );
    const values = { ...baseline, title: '', hero: { ...(baseline.hero as object), heading: 'Hello' } };
    const keys = dirtyKeysOf(values, baseline);
    expect(keys.sort()).toEqual(['hero', 'title']);
    expect(buildPatch(values, keys)).toEqual({ title: null, hero: { heading: 'Hello', image: null } });
    expect(toInputValue([])).toBeNull();
  });

  it('ignores client keys and empty-vs-missing when comparing', () => {
    expect(isSameContent(newComponentItem(hero, true), newComponentItem(hero, true))).toBe(true);
    expect(isSameContent(null, '')).toBe(true);
    expect(isSameContent([], undefined)).toBe(true);
  });
});

describe('mergeSaved', () => {
  it('takes the server value for untouched fields and keeps edits made while the save was in flight', () => {
    const sent = { title: 'home', slug: 'x', body: 'a' };
    const current = { ...sent, body: 'ab' };
    const saved = { title: 'Home', slug: 'x', body: 'a' };
    const merged = mergeSaved(current, sent, saved);
    expect(merged.values).toEqual({ title: 'Home', slug: 'x', body: 'ab' });
    expect(merged.baseline).toEqual(saved);
    expect(dirtyKeysOf(merged.values, merged.baseline)).toEqual(['body']);
  });

  it('keeps list items (and their client keys) when the server returns the same content', () => {
    const item = newComponentItem(hero, true);
    const sent = { sections: [item] };
    const saved = { sections: [{ ...(stripClientKeys(item) as object), [CLIENT_KEY]: 'other' }] };
    expect(mergeSaved(sent, sent, saved).values.sections).toBe(sent.sections);
  });
});
