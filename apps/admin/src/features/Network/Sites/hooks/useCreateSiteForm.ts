import { zodResolver } from '@hookform/resolvers/zod';
import type { Site } from '@shapio/client';
import { useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useCreateSite } from '@/api/sites';
import { deriveKey } from '@/helpers/deriveKey';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { useValueFromSource } from '@/hooks/useValueFromSource';
import { SITE_KEY_PATTERN } from '../../constants';

const createSiteSchema = z.object({
  name: requiredText().max(200, 'validation.tooLong'),
  key: z.string().trim().regex(SITE_KEY_PATTERN, 'validation.siteKey'),
});

export type CreateSiteValues = z.infer<typeof createSiteSchema>;

const EMPTY: CreateSiteValues = { name: '', key: '' };

/** The new-site sheet's form: a name and the fixed key its URLs use. */
export const useCreateSiteForm = (open: boolean, onCreated: (site: Site) => void) => {
  const createSite = useCreateSite();
  const form = useForm<CreateSiteValues>({ resolver: zodResolver(createSiteSchema), defaultValues: EMPTY });
  const { reset, getValues, setValue } = form;
  // The key follows the name until the user types one of their own, as a model's API ID follows its label.
  useValueFromSource(
    useWatch({ control: form.control, name: 'name' }),
    useCallback(() => getValues('key'), [getValues]),
    useCallback((key: string) => setValue('key', key, { shouldValidate: false }), [setValue]),
    deriveKey,
  );
  useEffect(() => {
    if (open) {
      reset(EMPTY);
    }
  }, [open, reset]);
  const onSubmit = form.handleSubmit(async (values) => {
    const created = await settle(createSite.mutateAsync(values));
    if (!created.ok) {
      return;
    }
    reset(EMPTY);
    onCreated(created.value);
  });
  return { form, onSubmit, createSite };
};
