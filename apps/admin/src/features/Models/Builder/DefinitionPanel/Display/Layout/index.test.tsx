// @vitest-environment jsdom
import '@/test/dom';
import { createDefinitionIndex, type ModelDefinition } from '@shapio/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { field, id, model } from '../../../../../../../../../packages/schema/src/testing/fixtures';
import { resolveDraft } from '../../../../helpers/inheritance';
import { Layout } from '.';

const page = model({
  id: id(1),
  apiKey: 'page',
  fields: [field({ id: id(2), apiKey: 'title', label: 'Title' })],
  display: { layout: 'form' },
});
const article = model({ id: id(3), apiKey: 'article', extends: page.id });
const note = model({ id: id(4), apiKey: 'note', display: { layout: 'form' } });

const parentOf = (draft: ModelDefinition) =>
  draft.extends ? createDefinitionIndex([page]).resolve(draft.extends) : undefined;

/** Renders the builder's Layout for the draft resolved over its parent, as the Display panel does. */
const renderLayout = (draft: ModelDefinition) => {
  const onChange = vi.fn();
  render(
    <Layout
      model={resolveDraft(draft, parentOf(draft)) as ModelDefinition}
      issues={[]}
      disabled={false}
      onChange={onChange}
    />,
  );
  return { onChange };
};

const choose = async (label: string) => {
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

describe('Layout', () => {
  it('shows the layout a kind inherits while it sets none', () => {
    renderLayout(article);
    expect(screen.getByRole('combobox').textContent).toBe('Form');
  });

  it('writes Document explicitly on a kind, so it overrides the inherited Form', async () => {
    const { onChange } = renderLayout(article);
    await choose('Document');
    expect(onChange).toHaveBeenCalledWith('document');
  });

  it('writes Document as unset on a model that extends nothing', async () => {
    const { onChange } = renderLayout(note);
    await choose('Document');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
