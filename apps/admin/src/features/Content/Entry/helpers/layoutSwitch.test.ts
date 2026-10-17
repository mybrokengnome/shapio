import { createDefinitionIndex, entryLayoutOf } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { isDraftDirty } from '@/features/Models/helpers/draft';
import { field, id, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { withEntryLayout } from './layoutSwitch';

const page = model({
  id: id(1),
  apiKey: 'page',
  fields: [field({ id: id(2), apiKey: 'title' })],
  display: { layout: 'form' },
});
const article = model({ id: id(3), apiKey: 'article', extends: page.id, display: { titleFieldId: id(2) } });
const note = model({ id: id(4), apiKey: 'note' });

describe('withEntryLayout', () => {
  it('leaves Document unset on a model that extends nothing', () => {
    const form = withEntryLayout(note, 'form');
    expect(form.display).toEqual({ layout: 'form' });
    expect(withEntryLayout(form, 'document').display).toEqual({});
  });

  it('writes either layout explicitly on a kind, so Document overrides the inherited Form', () => {
    const document = withEntryLayout(article, 'document');
    expect(document.display).toEqual({ titleFieldId: id(2), layout: 'document' });
    expect(isDraftDirty(document, article)).toBe(true);
    const index = createDefinitionIndex([page, document]);
    expect(entryLayoutOf(index.resolve(article.id)!)).toBe('document');
    expect(withEntryLayout(document, 'form').display).toEqual({ titleFieldId: id(2), layout: 'form' });
  });
});
