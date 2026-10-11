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

  it('marks a type it cannot convert to as unavailable, with the reason', () => {
    const choices = choicesFor('date');
    expect(choices.unavailable.has('media')).toBe(true);
    expect(choices.unavailableReason('media')).toBe("Shapio can't convert Date to Media.");
    expect(choices.limitedNote).toBe("Greyed-out types: Shapio can't convert Date to them.");
  });
});
