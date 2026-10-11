// @vitest-environment jsdom
import '@/test/dom';
import type { DataType } from '@shapio/schema';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../../../packages/schema/src/testing/fixtures';
import { useTypeChoices } from './useTypeChoices';

const article = model({ fields: [field({ apiKey: 'title' }), field({ apiKey: 'published', type: 'date' })] });
const saved = article.fields[1];

const choicesFor = (type: DataType) => renderHook(() => useTypeChoices(article, saved, type)).result.current;

describe('useTypeChoices', () => {
  it('says a date can become long text and keeps its values', () => {
    expect(choicesFor('text').notes).toEqual([
      'You can change this.',
      'Stored values stay as they are.',
      'API clients will see a different type for this field.',
    ]);
  });

  it('says a date can become rich text and converts its values', () => {
    expect(choicesFor('richtext').notes).toEqual([
      'You can change this.',
      'Existing values will be converted when you save.',
      'API clients will see a different type for this field.',
    ]);
  });

  it('has nothing to say about the saved type', () => {
    expect(choicesFor('date').notes).toEqual([]);
  });

  it('says a date that becomes media loses every stored value', () => {
    const choices = choicesFor('media');
    expect(choices.dropsValues).toBe(true);
    expect(choices.notes).toEqual([
      "Shapio can't convert Date to Media. Every stored value in this field will be dropped, and old API clients will see it empty.",
    ]);
  });

  it('keeps the ordinary notes for a change it converts', () => {
    expect(choicesFor('richtext').dropsValues).toBe(false);
  });

  it('says a multi-value choice that becomes short text loses every stored value', () => {
    const tagged = model({
      fields: [
        field({
          apiKey: 'tags',
          type: 'enum',
          settings: { multiple: true, values: [{ value: 'a', label: 'A' }] },
        }),
      ],
    });
    const choices = renderHook(() => useTypeChoices(tagged, tagged.fields[0], 'string')).result.current;
    expect(choices.dropsValues).toBe(true);
  });
});
