import { effectiveLayout } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { isSummarizable } from './assistEligibility';

const article = model({
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'excerpt', label: 'Excerpt', type: 'text' }),
    field({ apiKey: 'subtitle', label: 'Subtitle' }),
    field({ apiKey: 'readingTime', label: 'Reading time', type: 'integer' }),
    field({ apiKey: 'body', label: 'Body', type: 'richtext' }),
  ],
});
const fieldOf = (definition: typeof article, apiKey: string) => {
  const found = definition.fields.find((candidate) => candidate.apiKey === apiKey);
  if (!found) {
    throw new Error(`no field ${apiKey}`);
  }
  return found;
};

describe('isSummarizable', () => {
  const layout = effectiveLayout(article);

  it('accepts string and text properties of a model with a rich-text body', () => {
    expect(isSummarizable(layout, fieldOf(article, 'excerpt'))).toBe(true);
    expect(isSummarizable(layout, fieldOf(article, 'subtitle'))).toBe(true);
  });

  it('refuses the title, other types and the canvas itself', () => {
    expect(isSummarizable(layout, fieldOf(article, 'title'))).toBe(false);
    expect(isSummarizable(layout, fieldOf(article, 'readingTime'))).toBe(false);
    expect(isSummarizable(layout, fieldOf(article, 'body'))).toBe(false);
  });

  it('refuses everything when there is no rich-text body', () => {
    const author = model({
      fields: [
        field({ apiKey: 'name', label: 'Name' }),
        field({ apiKey: 'bio', label: 'Bio', type: 'text' }),
      ],
    });
    expect(isSummarizable(effectiveLayout(author), fieldOf(author, 'bio'))).toBe(false);
  });

  it('accepts a string or text field placed in the document', () => {
    const excerpt = fieldOf(article, 'excerpt');
    const body = fieldOf(article, 'body');
    const placed = effectiveLayout({ ...article, display: { canvasFieldIds: [excerpt.id, body.id] } });
    expect(isSummarizable(placed, excerpt)).toBe(true);
  });
});
