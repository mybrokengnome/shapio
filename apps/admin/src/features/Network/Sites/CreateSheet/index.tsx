import type { Site } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { useCreateSiteForm } from '../hooks/useCreateSiteForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (site: Site) => void;
};

/** A new site: its name, and the key that its URLs and API calls use (fixed once created). */
export const CreateSheet = ({ open, onOpenChange, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createSite } = useCreateSiteForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('sites.createTitle')}
      dirty={form.formState.isDirty}
      pending={createSite.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormTextField control={form.control} name="name" label={t('sites.name')} autoComplete="off" />
      <FormTextField
        control={form.control}
        name="key"
        label={t('sites.key')}
        autoComplete="off"
        spellCheck={false}
        hint={t('sites.keyHint')}
        description={t('sites.keyFixed')}
      />
      <FormError error={createSite.error} />
    </FormSheet>
  );
};
