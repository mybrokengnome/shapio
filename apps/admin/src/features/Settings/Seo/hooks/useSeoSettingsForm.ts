import { zodResolver } from '@hookform/resolvers/zod';
import type { Locale } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { toast } from 'sonner';
import { hasErrorCode, isConflict } from '@/api/errors';
import { useMediaAsset } from '@/api/media';
import { siteSeoQueryOptions, useUpdateSiteSeo, type SiteSeo } from '@/api/seo';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';
import { reportError } from '@/helpers/reportError';
import {
  firstLocaleWithErrors,
  seoSettingsSchema,
  toSeoDefaults,
  toSeoSettingsValues,
  type SeoSettingsValues,
} from '../helpers';

/** The server refused the default image (another site's, not an image, or private). */
const SEO_IMAGE_INVALID = 'SEO_IMAGE_INVALID';

/**
 * Settings → SEO: the site's default texts per locale, default social image and Twitter handle, saved with
 * the site version they were read at (a conflict asks to reload). The image must be public: a private one is
 * refused here before the server would.
 */
export const useSeoSettingsForm = (siteSeo: SiteSeo, locales: readonly Locale[]) => {
  const queryClient = useQueryClient();
  const update = useUpdateSiteSeo();
  const defaultLocale = locales.find((locale) => locale.isDefault)?.code ?? locales[0]?.code ?? '';
  const [locale, setLocale] = useState(defaultLocale);
  const [version, setVersion] = useState(siteSeo.version);
  const form = useForm<SeoSettingsValues>({
    resolver: zodResolver(seoSettingsSchema),
    defaultValues: toSeoSettingsValues(siteSeo.seo, locales),
  });
  const imageId = useWatch({ control: form.control, name: 'imageId' });
  const image = useMediaAsset(imageId ?? undefined);
  const imagePrivate = imageId !== null && image.data?.visibility === 'private';
  const { clearErrors } = form;
  // The server's verdict on an image is about that image: another choice clears it.
  useEffect(() => clearErrors('imageId'), [imageId, clearErrors]);

  const reload = async () => {
    try {
      const fresh = await queryClient.fetchQuery({ ...siteSeoQueryOptions, staleTime: 0 });
      form.reset(toSeoSettingsValues(fresh.seo, locales));
      setVersion(fresh.version);
    } catch (error) {
      reportError(error, 'reloading the SEO settings');
    }
  };

  const save = async (values: SeoSettingsValues) => {
    if (imagePrivate) {
      return;
    }
    try {
      const saved = await update.mutateAsync({ expectedVersion: version, seo: toSeoDefaults(values) });
      form.reset(toSeoSettingsValues(saved.seo, locales));
      setVersion(saved.version);
      toast.success(i18next.t('seo.settings.saved'));
    } catch (error) {
      if (isConflict(error)) {
        toast.error(i18next.t('seo.settings.conflict'), {
          action: { label: i18next.t('seo.settings.reload'), onClick: () => void reload() },
        });
        return;
      }
      if (hasErrorCode(error, SEO_IMAGE_INVALID)) {
        form.setError('imageId', { message: describeError(error) }, { shouldFocus: false });
        return;
      }
      toast.error(describeError(error));
    }
  };

  const showInvalidLocale = (errors: FieldErrors<SeoSettingsValues>) => {
    const invalid = firstLocaleWithErrors(errors);
    if (invalid !== undefined) {
      setLocale(invalid);
    }
  };

  return {
    form,
    locale,
    setLocale,
    imagePrivate,
    pending: update.isPending,
    onSubmit: form.handleSubmit(save, showInvalidLocale),
  };
};
