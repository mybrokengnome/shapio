import type { ChangeSet } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { useCreateChangeSetForm } from '../hooks/useCreateChangeSetForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (set: ChangeSet) => void;
};

/** "New change set": a title and an optional description, in a sheet beside the list. */
export const CreateSheet = ({ open, onOpenChange, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createChangeSet } = useCreateChangeSetForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('changes.createTitle')}
      dirty={form.formState.isDirty}
      pending={createChangeSet.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormTextField
        control={form.control}
        name="title"
        label={t('changes.fields.title')}
        autoComplete="off"
      />
      <FormTextareaField
        control={form.control}
        name="description"
        label={t('changes.fields.description')}
        rows={3}
      />
      <FormError error={createChangeSet.error} />
    </FormSheet>
  );
};
