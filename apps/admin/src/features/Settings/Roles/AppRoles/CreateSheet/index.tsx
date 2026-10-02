import type { AppRole } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { useCreateAppRoleForm } from '../hooks/useCreateAppRoleForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (role: AppRole) => void;
};

export const CreateSheet = ({ open, onOpenChange, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createAppRole } = useCreateAppRoleForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('appRoles.createTitle')}
      dirty={form.formState.isDirty}
      pending={createAppRole.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormTextField control={form.control} name="name" label={t('roles.name')} autoComplete="off" />
      <FormTextField
        control={form.control}
        name="key"
        label={t('roles.key')}
        hint={t('roles.keyHint')}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
      <FormTextareaField
        control={form.control}
        name="description"
        label={t('roles.roleDescription')}
        rows={2}
      />
      <FormError error={createAppRole.error} />
    </FormSheet>
  );
};
