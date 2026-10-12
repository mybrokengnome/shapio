import type { Role } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSelectField } from '@/components/FormSelectField';
import { FormSheet } from '@/components/FormSheet';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { ROLE_KINDS } from '../constants';
import { useCreateRoleForm } from '../hooks/useCreateRoleForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (role: Role) => void;
};

const KIND_LABEL_KEYS = { admin: 'roles.kindAdmin', delivery: 'roles.kindDelivery' } as const;

/** A new admin or delivery role: name, key and kind; its permissions are set on its page next. */
export const CreateSheet = ({ open, onOpenChange, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createRole } = useCreateRoleForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('roles.createTitle')}
      dirty={form.formState.isDirty}
      pending={createRole.isPending}
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
      <FormSelectField
        control={form.control}
        name="kind"
        label={t('roles.kind')}
        hint={t('roles.kindHint')}
        options={ROLE_KINDS.map((value) => ({ value, label: t(KIND_LABEL_KEYS[value]) }))}
      />
      <FormError error={createRole.error} />
    </FormSheet>
  );
};
