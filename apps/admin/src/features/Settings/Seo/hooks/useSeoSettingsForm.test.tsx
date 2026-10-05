// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError, type Locale } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SeoApi from '@/api/seo';
import type { SiteSeo } from '@/api/seo';
import { useSeoSettingsForm } from './useSeoSettingsForm';

const IMAGE_ID = 'a6c1d7f0-1111-4aaa-8bbb-000000000001';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  visibility: 'public',
}));

vi.mock('@/api/seo', async (original) => ({
  ...(await original<typeof SeoApi>()),
  useUpdateSiteSeo: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('@/api/media', () => ({
  useMediaAsset: (id: string | undefined) => ({
    data: id ? { id, visibility: mocks.visibility } : undefined,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const locales = [
  { code: 'en', label: 'English', fallbacks: [], isDefault: true },
  { code: 'fr', label: 'French', fallbacks: [], isDefault: false },
] as Locale[];

const loaded: SiteSeo = {
  version: 4,
  seo: { locales: { en: { siteName: 'Acme' } }, imageId: null, twitterHandle: null },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const setup = (siteSeo: SiteSeo = loaded) =>
  renderHook(() => useSeoSettingsForm(siteSeo, locales), { wrapper }).result;

describe('useSeoSettingsForm', () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.visibility = 'public';
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it('starts on the default locale and saves with the version it read', async () => {
    const result = setup();
    expect(result.current.locale).toBe('en');
    mocks.update.mockImplementation(({ seo }: { seo: SiteSeo['seo'] }) =>
      Promise.resolve({ version: 5, seo }),
    );
    act(() => result.current.form.setValue('locales.fr.titleTemplate', '%s · Acmé', { shouldDirty: true }));
    await act(() => result.current.onSubmit());
    expect(mocks.update).toHaveBeenCalledWith({
      expectedVersion: 4,
      seo: {
        locales: { en: { siteName: 'Acme' }, fr: { titleTemplate: '%s · Acmé' } },
        imageId: null,
        twitterHandle: null,
      },
    });
    expect(toast.success).toHaveBeenCalledWith('SEO settings saved.');
    expect(result.current.form.formState.isDirty).toBe(false);
  });

  it('shows the locale holding an invalid template instead of saving', async () => {
    const result = setup();
    act(() => result.current.form.setValue('locales.fr.titleTemplate', 'Acmé', { shouldDirty: true }));
    await act(() => result.current.onSubmit());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.locale).toBe('fr');
  });

  it('refuses a private default image', async () => {
    mocks.visibility = 'private';
    const result = setup({ ...loaded, seo: { ...loaded.seo, imageId: IMAGE_ID } });
    expect(result.current.imagePrivate).toBe(true);
    await act(() => result.current.onSubmit());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('asks to reload when someone else saved first', async () => {
    mocks.update.mockRejectedValue(
      new ShapioApiError(409, { error: { code: 'SITE_VERSION_CONFLICT', message: 'moved' } }),
    );
    const result = setup();
    await act(() => result.current.onSubmit());
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Someone else changed'),
      expect.objectContaining({ action: expect.objectContaining({ label: 'Reload' }) as unknown }),
    );
  });

  it('shows a refused image beside the image control, not as a toast', async () => {
    mocks.update.mockRejectedValue(
      new ShapioApiError(400, { error: { code: 'SEO_IMAGE_INVALID', message: 'The image must be public.' } }),
    );
    const result = setup({ ...loaded, seo: { ...loaded.seo, imageId: IMAGE_ID } });
    await act(() => result.current.onSubmit());
    expect(result.current.form.getFieldState('imageId').error?.message).toBe('The image must be public.');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
