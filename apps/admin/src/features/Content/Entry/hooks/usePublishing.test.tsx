// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError, type AdminEntry } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ContentApi from '@/api/content';
import { createEntryFormStore } from '@/fields/form/store';
import { reportError } from '@/helpers/reportError';
import type { SaveOutcome } from './useEntrySaver';
import { usePublishing } from './usePublishing';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/api/content', async (original) => ({
  ...(await original<typeof ContentApi>()),
  usePublishEntry: () => ({ mutateAsync: mocks.publish, isPending: false }),
  useUnpublishEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ reportError: vi.fn(), logError: vi.fn() }));

const conflict = new ShapioApiError(409, {
  error: { code: 'CONTENT_VERSION_CONFLICT', message: 'moved', details: { expectedVersion: 3 } },
});

const locales = [
  { locale: 'en', version: 3, status: 'draft', publishedAt: null, sharedOutdated: false },
  { locale: 'fr', version: 7, status: 'modified', publishedAt: null, sharedOutdated: true },
  { locale: 'de', version: 2, status: 'published', publishedAt: null, sharedOutdated: false },
] as AdminEntry['locales'];

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const setup = (outcome: SaveOutcome = 'saved', dirty = false) => {
  const store = createEntryFormStore({ title: 'Seen' });
  if (dirty) {
    store.getState().setValue('title', 'Edited');
  }
  const onConflict = vi.fn();
  const onEntry = vi.fn();
  const save = vi.fn(async () => outcome);
  const { result } = renderHook(
    () =>
      usePublishing({
        modelKey: 'article',
        entryId: 'e1',
        autosaved: false,
        locale: 'en',
        versionRef: { current: 3 },
        entryLocales: locales,
        store,
        save,
        exclusive: (task) => task(),
        onEntry,
        onConflict,
      }),
    { wrapper },
  );
  return { publishing: result.current, onConflict, onEntry, save };
};

describe('usePublishing', () => {
  beforeEach(() => {
    mocks.publish.mockReset();
    vi.mocked(reportError).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it('publishes with the draft version on screen', async () => {
    mocks.publish.mockResolvedValue({ version: 3 });
    const { publishing, onEntry } = setup();
    await expect(publishing.publish()).resolves.toBe(true);
    expect(mocks.publish).toHaveBeenCalledWith({ id: 'e1', locales: ['en'], expectedVersion: 3 });
    expect(onEntry).toHaveBeenCalledWith({ version: 3 });
  });

  it('hands a stale publish to the conflict banner instead of reporting it', async () => {
    mocks.publish.mockRejectedValue(conflict);
    const { publishing, onConflict, onEntry } = setup();
    // True closes the pre-flight so the banner shows.
    await expect(publishing.publish()).resolves.toBe(true);
    expect(onConflict).toHaveBeenCalledWith(conflict);
    expect(onEntry).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('closes the pre-flight without publishing when the save before it conflicts', async () => {
    const { publishing, save } = setup('conflict', true);
    await expect(publishing.publish()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith('save');
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('publishes the other locales with the versions it last read, and handles their conflict too', async () => {
    mocks.publish.mockRejectedValue(conflict);
    const { publishing, onConflict } = setup();
    await publishing.publishOthers(['fr', 'de']);
    expect(mocks.publish).toHaveBeenCalledWith({
      id: 'e1',
      locales: ['fr', 'de'],
      expectedVersions: { fr: 7, de: 2 },
    });
    expect(onConflict).toHaveBeenCalledWith(conflict);
    expect(reportError).not.toHaveBeenCalled();
  });
});
