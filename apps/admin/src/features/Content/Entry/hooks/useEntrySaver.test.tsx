// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError, type AdminEntry } from '@shapio/client';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntryFormStore, selectDirtyKeys } from '@/fields/form/store';
import { isUnparsed, unparsedText } from '@/fields/helpers/unparsed';
import { useSessionStore } from '@/stores/session';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { useEntrySaver } from './useEntrySaver';

const mutateAsync = vi.fn<(variables: { id?: string; input: { data: unknown } }) => Promise<AdminEntry>>();
vi.mock('@/api/content', () => ({ useSaveEntry: () => ({ mutateAsync }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ logError: vi.fn(), reportError: vi.fn() }));

const article = model({
  apiKey: 'article',
  fields: [field({ apiKey: 'title' }), field({ apiKey: 'views', type: 'integer' })],
});

const setup = () => {
  const store = createEntryFormStore({ title: 'Saved', views: 1 });
  const { result } = renderHook(() =>
    useEntrySaver({
      model: article,
      components: new Map(),
      entryId: 'e1',
      locale: null,
      store,
      versionRef: { current: 1 },
      onSaved: () => {},
      onConflict: () => {},
      onAsset: () => {},
    }),
  );
  return { store, saver: result };
};

beforeEach(() => {
  mutateAsync.mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('useEntrySaver with text an editor could not parse', () => {
  it('refuses an explicit save without a request, and says why', async () => {
    const { store, saver } = setup();
    act(() => store.getState().setValue('views', unparsedText('3.7')));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await saver.current.save('save');
    });
    expect(outcome).toBe('invalid');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('1 field needs attention before this can be saved.');
    expect(store.getState().revealAll).toBe(true);
    expect(saver.current.state.status).not.toBe('saved');
    expect(selectDirtyKeys(store.getState())).toEqual(['views']);
  });

  it('autosaves the other changes and holds the field back as an unsaved change', async () => {
    const { store, saver } = setup();
    act(() => {
      store.getState().setValue('title', 'Edited');
      store.getState().setValue('views', unparsedText('3.7'));
    });
    const saved: Partial<AdminEntry> = {
      id: 'e1',
      version: 2,
      updatedAt: '2026-10-11T00:00:00.000Z',
      data: { title: 'Edited', views: 1 },
    };
    mutateAsync.mockResolvedValue(saved as AdminEntry);
    await act(async () => {
      await saver.current.save('autosave');
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.lastCall?.[0].input.data).toEqual({ title: 'Edited' });
    expect(isUnparsed(store.getState().values.views)).toBe(true);
    expect(selectDirtyKeys(store.getState())).toEqual(['views']);
  });

  it('skips autosave when the only change does not parse', async () => {
    const { store, saver } = setup();
    act(() => store.getState().setValue('views', unparsedText('x')));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await saver.current.save('autosave');
    });
    expect(outcome).toBe('unchanged');
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

const titled = model({ fields: [field({ apiKey: 'title' })] });

const savedEntry = (title: string, version: number) =>
  ({ id: 'e1', version, data: { title }, updatedAt: '2026-10-11T00:00:00.000Z' }) as unknown as AdminEntry;

const setupSession = () => {
  const store = createEntryFormStore({ title: 'Saved title' });
  const versionRef = { current: 3 };
  const onSaved = vi.fn();
  const { result } = renderHook(() =>
    useEntrySaver({
      model: titled,
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
    mutateAsync.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSessionStore.setState({ resumed: 0, signInRequired: false });
  });

  it('keeps the edits, says nothing itself, and saves them once the session is resumed', async () => {
    const { store, versionRef, onSaved, result } = setupSession();
    act(() => store.getState().setValue('title', 'Typed while signed out'));
    mutateAsync.mockRejectedValueOnce(
      new ShapioApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }),
    );
    await act(async () => {
      expect(await result.current.save('save')).toBe('failed');
    });
    expect(store.getState().values.title).toBe('Typed while signed out');
    expect(toast.error).not.toHaveBeenCalled();

    mutateAsync.mockResolvedValueOnce(savedEntry('Typed while signed out', 4));
    act(() => useSessionStore.getState().resume());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      id: 'e1',
      input: { expectedVersion: 3, data: { title: 'Typed while signed out' } },
    });
    expect(versionRef.current).toBe(4);
    expect(onSaved.mock.calls[0]?.[1]).toBe('save');
  });

  it('runs nothing on a resume when no save failed', async () => {
    setupSession();
    act(() => useSessionStore.getState().resume());
    await Promise.resolve();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
