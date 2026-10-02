import { zodResolver } from '@hookform/resolvers/zod';
import type { Locale } from '@shapio/client';
import { LOCALE_CODE_PATTERN } from '@shapio/schema';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateLocale, useUpdateLocale } from '@/api/locales';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const MAX_CODE_LENGTH = 35;

const localeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .max(MAX_CODE_LENGTH, 'validation.localeCode')
    .regex(LOCALE_CODE_PATTERN, 'validation.localeCode'),
  label: requiredText(),
  fallbacks: z.array(z.string()),
});

export type LocaleValues = z.infer<typeof localeSchema>;

const valuesFor = (locale: Locale | undefined): LocaleValues => ({
  code: locale?.code ?? '',
  label: locale?.label ?? '',
  fallbacks: locale?.fallbacks ?? [],
});

/** Adds a locale, or edits one's label and fallback chain (the code is its identity and never changes). */
export const useLocaleForm = (open: boolean, locale: Locale | undefined, onDone: () => void) => {
  const createLocale = useCreateLocale();
  const updateLocale = useUpdateLocale();
  const form = useForm<LocaleValues>({
    resolver: zodResolver(localeSchema),
    defaultValues: valuesFor(locale),
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(valuesFor(locale));
      createLocale.reset();
      updateLocale.reset();
    }
    // Only when the dialog opens; the mutation objects change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locale, reset]);
  const onSubmit = form.handleSubmit(async ({ code, label, fallbacks }) => {
    const result = await settle(
      locale
        ? updateLocale.mutateAsync({ code: locale.code, input: { label, fallbacks } })
        : createLocale.mutateAsync({ code, label, fallbacks }),
    );
    if (!result.ok) {
      return;
    }
    toast.success(i18next.t(locale ? 'locales.saved' : 'locales.created', { label }));
    onDone();
  });
  const mutation = locale ? updateLocale : createLocale;
  return { form, onSubmit, pending: mutation.isPending, error: mutation.error };
};
