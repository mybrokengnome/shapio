import { zodResolver } from '@hookform/resolvers/zod';
import type { Site } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateSite } from '@/api/sites';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const renameSchema = z.object({ name: requiredText().max(200, 'validation.tooLong') });

export type RenameSiteValues = z.infer<typeof renameSchema>;

/** A site's name, saved with the version it was loaded at (a stale save is refused, 409). */
export const useRenameSiteForm = (site: Site) => {
  const updateSite = useUpdateSite();
  const form = useForm<RenameSiteValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: site.name },
  });
  const { reset, formState } = form;
  // Follow the server's value when it changes elsewhere, unless the admin is mid-edit.
  useEffect(() => {
    if (!formState.isDirty) {
      reset({ name: site.name });
    }
  }, [site.name, reset, formState.isDirty]);
  const onSubmit = form.handleSubmit(async ({ name }) => {
    const saved = await settle(
      updateSite.mutateAsync({ id: site.id, input: { expectedVersion: site.version, name } }),
    );
    if (!saved.ok) {
      return;
    }
    reset({ name: saved.value.name });
    toast.success(i18next.t('sites.renamed'));
  });
  return { form, onSubmit, updateSite };
};
