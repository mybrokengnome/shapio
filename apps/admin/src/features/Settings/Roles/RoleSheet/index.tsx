import type { PermissionAction, Role } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import { FormError } from '@/components/FormError';
import { FormSelectField } from '@/components/FormSelectField';
import { FormSheet } from '@/components/FormSheet';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { ACTION_LABEL_KEYS, CONTENT_ACTIONS_BY_KIND, GLOBAL_ACTIONS, ROLE_KINDS } from '../constants';
import { useRoleForm } from '../hooks/useRoleForm';

type RoleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this role; create a new one when undefined. */
  role: Role | undefined;
};

const KIND_LABEL_KEYS = { admin: 'roles.kindAdmin', delivery: 'roles.kindDelivery' } as const;

/** Content actions with an explanation behind an info icon. */
const ACTION_HINT_KEYS: Partial<Record<PermissionAction, 'roles.actions.readDraftsHint'>> = {
  readDrafts: 'roles.actions.readDraftsHint',
};

export const RoleSheet = ({ open, onOpenChange, role }: RoleSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, pending, error } = useRoleForm(open, role, () => onOpenChange(false));
  const isEdit = role !== undefined;
  const kind = form.watch('kind');
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={isEdit ? t('roles.editTitle') : t('roles.createTitle')}
      dirty={form.formState.isDirty}
      pending={pending}
      submitLabel={isEdit ? t('common.saveChanges') : t('common.create')}
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
        disabled={isEdit}
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
        disabled={isEdit}
      />
      <FormCheckboxGroup
        control={form.control}
        name="actions"
        legend={t('roles.contentPermissions')}
        options={CONTENT_ACTIONS_BY_KIND[kind].map((action) => {
          const hintKey = ACTION_HINT_KEYS[action];
          return {
            value: action,
            label: t(ACTION_LABEL_KEYS[action]),
            ...(hintKey ? { hint: t(hintKey) } : {}),
          };
        })}
      />
      {kind === 'admin' ? (
        <FormCheckboxGroup
          control={form.control}
          name="actions"
          legend={t('roles.instancePermissions')}
          options={GLOBAL_ACTIONS.map((action) => ({ value: action, label: t(ACTION_LABEL_KEYS[action]) }))}
        />
      ) : null}
      <FormError error={error} />
    </FormSheet>
  );
};
