// @vitest-environment jsdom
import '@/test/dom';
import { createDefinitionIndex, entryLayoutOf, type ModelDefinition } from '@shapio/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { field, id, model } from '../../../../../../../../../packages/schema/src/testing/fixtures';
import { resolveDraft } from '../../../../helpers/inheritance';
import { Layout } from '.';

const page = model({
  id: id(1),
  apiKey: 'page',
  label: 'Page',
  fields: [field({ id: id(2), apiKey: 'title', label: 'Title' })],
  display: { layout: 'form' },
});
const article = (display: ModelDefinition['display'] = {}) =>
  model({ id: id(3), apiKey: 'article', extends: page.id, display });
const note = model({ id: id(4), apiKey: 'note', display: { layout: 'form' } });

/** Renders the builder's Layout as the Display panel does: the resolved draft, its own value, its parent. */
const renderLayout = (draft: ModelDefinition) => {
  const onChange = vi.fn();
  const parent = draft.extends ? createDefinitionIndex([page]).resolve(draft.extends) : undefined;
  render(
    <Layout
      model={resolveDraft(draft, parent) as ModelDefinition}
      ownLayout={draft.display.layout}
      inherited={parent ? { parentLabel: parent.label, layout: entryLayoutOf(parent) } : undefined}
      issues={[]}
      disabled={false}
      onChange={onChange}
    />,
  );
  return { onChange };
};

const open = async () => {
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  return screen.findAllByRole('option');
};
const choose = async (label: string) => {
  await open();
  fireEvent.click(screen.getByRole('option', { name: label }));
};

describe('Layout', () => {
  it('selects "Same as" on a kind without its own layout, naming the parent and its layout', async () => {
    renderLayout(article());
    expect(screen.getByRole('combobox').textContent).toBe('Same as Page (Form)');
    expect((await open()).map((option) => option.textContent)).toEqual([
      'Same as Page (Form)',
      'Document',
      'Form',
    ]);
    // The form preview follows the effective layout.
    expect(screen.getByText(/Form preview/)).toBeTruthy();
  });

  it('selects a kind’s own layout, even when it matches the parent’s, and writes Document explicitly', async () => {
    const { onChange } = renderLayout(article({ layout: 'form' }));
    expect(screen.getByRole('combobox').textContent).toBe('Form');
    await choose('Document');
    expect(onChange).toHaveBeenCalledWith('document');
  });

  it('clears a kind’s own layout when "Same as" is chosen', async () => {
    const { onChange } = renderLayout(article({ layout: 'document' }));
    await choose('Same as Page (Form)');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('offers a model that extends nothing Document and Form only, Document written as unset', async () => {
    const { onChange } = renderLayout(note);
    expect(screen.getByRole('combobox').textContent).toBe('Form');
    expect((await open()).map((option) => option.textContent)).toEqual(['Document', 'Form']);
    fireEvent.click(screen.getByRole('option', { name: 'Document' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
