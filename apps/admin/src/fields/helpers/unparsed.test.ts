import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../packages/schema/src/testing/fixtures';
import { clientIssuesOf } from './clientValidation';
import { buildCreateData, buildPatch, dirtyKeysOf, mergeSaved } from './formValues';
import { summarizeValue } from './summary';
import { cloneValue, containsUnparsed, isUnparsed, unparsedPathsOf, unparsedText } from './unparsed';
import { isDeepEqual, isSameContent, stripClientKeys } from './values';

const [views, meta] = model({
  fields: [field({ apiKey: 'views', type: 'integer' }), field({ apiKey: 'meta', type: 'json' })],
}).fields;

describe('unparsed text in form values', () => {
  it('finds unparsed text at any depth, component items included', () => {
    const values = {
      views: unparsedText('3.7'),
      title: 'Hello',
      sections: [
        { __key: 'a', count: 2 },
        { __key: 'b', count: unparsedText('2x') },
      ],
    };
    expect(unparsedPathsOf(values)).toEqual(['/views', '/sections/1/count']);
    expect(containsUnparsed(values.sections)).toBe(true);
    expect(containsUnparsed({ text: '3.7' })).toBe(false);
  });

  it('counts as a change, compared by its text and never equal to a plain value', () => {
    expect(dirtyKeysOf({ views: unparsedText('5x') }, { views: 5 })).toEqual(['views']);
    expect(dirtyKeysOf({ meta: unparsedText('x') }, { meta: { text: 'x' } })).toEqual(['meta']);
    expect(dirtyKeysOf({ views: unparsedText('') }, { views: null })).toEqual(['views']);
    expect(isDeepEqual(unparsedText('a'), unparsedText('a'))).toBe(true);
    expect(isDeepEqual(unparsedText('a'), unparsedText('b'))).toBe(false);
    expect(isSameContent(unparsedText('a'), { text: 'a' })).toBe(false);
    expect(isUnparsed(stripClientKeys(unparsedText('a')))).toBe(true);
  });

  it('is never sent: building a patch or a create body throws', () => {
    expect(() => buildPatch({ views: unparsedText('3.7') }, ['views'])).toThrow(/views/);
    expect(() => buildCreateData({ meta: unparsedText('{bad') })).toThrow(/meta/);
    expect(() => buildPatch({ list: [{ count: unparsedText('x') }] }, ['list'])).toThrow(/list/);
    expect(buildPatch({ views: 3, meta: unparsedText('x') }, ['views'])).toEqual({ views: 3 });
  });

  it('survives a save that held it back, and stays an unsaved change', () => {
    const typed = unparsedText('3.7');
    const current = { views: typed, title: 'New' };
    const sent = { title: 'New' };
    const merged = mergeSaved(current, sent, { views: 1, title: 'New' });
    expect(merged.values.views).toBe(typed);
    expect(dirtyKeysOf(merged.values, merged.baseline)).toEqual(['views']);
  });

  it('is kept when an item is duplicated, and shown as typed in summaries', () => {
    const typed = unparsedText('2x');
    const copy = cloneValue({ count: typed, tags: ['a'] });
    expect(copy.count).toBe(typed);
    expect(isUnparsed(copy.count)).toBe(true);
    expect(summarizeValue(meta!, unparsedText('{bad json'))).toBe('{bad json');
  });

  it('adds no second message: the editor shows its own', () => {
    expect(clientIssuesOf(views!, unparsedText('3.7'))).toEqual([]);
  });
});
