// @vitest-environment jsdom
import '@/test/dom';
import type { AdminEntry } from '@shapio/client';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEntryFormStore } from '@/fields/form/store';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import type { EntryMode } from '../types';
import { useAssistDocument } from './useAssistTarget';
import type { SaveOutcome } from './useEntrySaver';

const article = model({ fields: [field({ apiKey: 'title', label: 'Title' })] });
const edit: EntryMode = { kind: 'edit', entry: {} as AdminEntry };

const setup = (options: {
  dirty: boolean;
  draftAndPublish?: boolean;
  outcome?: SaveOutcome;
  mode?: EntryMode;
}) => {
  const store = createEntryFormStore({ title: 'Saved' });
  if (options.dirty) {
    store.getState().setValue('title', 'Edited');
  }
  const save = vi.fn(async () => options.outcome ?? 'saved');
  const definition = { ...article, draftAndPublish: options.draftAndPublish ?? true };
  const { result } = renderHook(() =>
    useAssistDocument({ model: definition, mode: options.mode ?? edit, store, save }),
  );
  return { document: result.current, save };
};

describe('useAssistDocument', () => {
  it('is ready at once when nothing is unsaved', async () => {
    const { document, save } = setup({ dirty: false });
    await expect(document?.saveIfDirty()).resolves.toBe('ready');
    expect(save).not.toHaveBeenCalled();
  });

  it('saves unsaved changes as a draft first (the autosave path)', async () => {
    const { document, save } = setup({ dirty: true });
    await expect(document?.saveIfDirty()).resolves.toBe('ready');
    expect(save).toHaveBeenCalledWith('autosave');
  });

  it('reports a save that did not go through', async () => {
    const { document } = setup({ dirty: true, outcome: 'conflict' });
    await expect(document?.saveIfDirty()).resolves.toBe('failed');
  });

  it('never saves for the person where saving publishes (no drafts)', async () => {
    const { document, save } = setup({ dirty: true, draftAndPublish: false });
    await expect(document?.saveIfDirty()).resolves.toBe('saveFirst');
    expect(save).not.toHaveBeenCalled();
  });

  it('offers nothing outside edit mode', () => {
    expect(setup({ dirty: false, mode: { kind: 'create' } }).document).toBeNull();
  });
});
