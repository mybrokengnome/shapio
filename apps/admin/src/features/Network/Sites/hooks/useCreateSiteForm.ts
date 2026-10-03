import { zodResolver } from '@hookform/resolvers/zod';
import type { Site } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCreateSite } from '@/api/sites';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
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
  const { reset } = form;
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
