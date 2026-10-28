import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { isConflict } from '@/api/errors';
import { useUpdateSiteChangeSets, type SiteChangeSets } from '@/api/siteChangeSets';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';

type ChangeSetSettingsValues = { requireApproval: boolean };

/**
 * Settings → Change sets: whether the site requires an approved change set before one ships (plan approval),
 * saved with the site version it was read at. A conflict means someone saved meanwhile: the page shows the
 * fresh value, so the person decides again.
 */
export const useChangeSetSettingsForm = (settings: SiteChangeSets) => {
  const update = useUpdateSiteChangeSets();
  const form = useForm<ChangeSetSettingsValues>({
    defaultValues: { requireApproval: settings.requireApproval },
  });
  const onSubmit = form.handleSubmit(async ({ requireApproval }) => {
    try {
      const saved = await update.mutateAsync({ expectedVersion: settings.version, requireApproval });
      form.reset({ requireApproval: saved.requireApproval });
      toast.success(i18next.t('siteChangeSets.saved'));
    } catch (error) {
      toast.error(isConflict(error) ? i18next.t('siteChangeSets.conflict') : describeError(error));
    }
  });
  return { form, onSubmit, pending: update.isPending };
};
