// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { createEntryFormStore } from '../form/store';
import { useFollowingSlugs } from './useFollowingSlugs';

const title = field({ apiKey: 'title' });
const story = model({
  fields: [title, field({ apiKey: 'slug', type: 'slug', settings: { sourceFieldId: title.id } })],
});

describe('useFollowingSlugs', () => {
  it('keeps a slug following its title without its editor on screen, until it is edited by hand', () => {
    const store = createEntryFormStore({});
    renderHook(() => useFollowingSlugs(store, story, true));
    store.getState().setValue('title', 'Hello World');
    expect(store.getState().values.slug).toBe('hello-world');
    store.getState().setValue('title', 'Hello World again');
    expect(store.getState().values.slug).toBe('hello-world-again');
    store.getState().setValue('slug', 'my-own');
    store.getState().setValue('title', 'Something else');
    expect(store.getState().values.slug).toBe('my-own');
  });
});
