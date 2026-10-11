// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError, type AdminEntry } from '@shapio/client';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntryFormStore } from '@/fields/form/store';
import { useSessionStore } from '@/stores/session';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { useEntrySaver } from './useEntrySaver';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/api/content', () => ({ useSaveEntry: () => ({ mutateAsync: mocks.save }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const article = model({ fields: [field({ apiKey: 'title' })] });

const saved = (title: string, version: number) =>
  ({ id: 'e1', version, data: { title }, updatedAt: '2026-10-11T00:00:00.000Z' }) as unknown as AdminEntry;

const setup = () => {
  const store = createEntryFormStore({ title: 'Saved title' });
  const versionRef = { current: 3 };
  const onSaved = vi.fn();
  const { result } = renderHook(() =>
    useEntrySaver({
      model: article,
      components: new Map(),
      entryId: 'e1',
      locale: null,
      store,
      versionRef,
      onSaved,
      onConflict: vi.fn(),
      onAsset: vi.fn(),
    }),
  );
  return { store, versionRef, onSaved, result };
};

describe('useEntrySaver when the session ends', () => {
  beforeEach(() => {
    mocks.save.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSessionStore.setState({ resumed: 0, signInRequired: false });
  });

  it('keeps the edits, says nothing itself, and saves them once the session is resumed', async () => {
    const { store, versionRef, onSaved, result } = setup();
    act(() => store.getState().setValue('title', 'Typed while signed out'));
    mocks.save.mockRejectedValueOnce(
      new ShapioApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }),
    );
    await act(async () => {
      expect(await result.current.save('save')).toBe('failed');
    });
    expect(store.getState().values.title).toBe('Typed while signed out');
    expect(toast.error).not.toHaveBeenCalled();

    mocks.save.mockResolvedValueOnce(saved('Typed while signed out', 4));
    act(() => useSessionStore.getState().resume());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({
      id: 'e1',
      input: { expectedVersion: 3, data: { title: 'Typed while signed out' } },
    });
    expect(versionRef.current).toBe(4);
    expect(onSaved.mock.calls[0]?.[1]).toBe('save');
  });

  it('runs nothing on a resume when no save failed', async () => {
    setup();
    act(() => useSessionStore.getState().resume());
    await Promise.resolve();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
