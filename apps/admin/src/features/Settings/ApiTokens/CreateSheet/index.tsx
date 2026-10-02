import type { CreatedApiToken } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useRoles } from '@/api/roles';
import { FormError } from '@/components/FormError';
import { FormSelectField } from '@/components/FormSelectField';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { TOKEN_EXPIRY_OPTIONS } from '../constants';
import { useCreateTokenForm } from '../hooks/useCreateTokenForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedApiToken) => void;
  /** See `FormSheet`: lets the page keep focus on the secret that replaces the sheet. */
  onCloseAutoFocus?: (event: Event) => void;
};

export const CreateSheet = ({ open, onOpenChange, onCreated, onCloseAutoFocus }: CreateSheetProps) => {
  const { t } = useTranslation();
  const roles = useRoles();
  const { form, onSubmit, createToken } = useCreateTokenForm(open, onCreated);
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role.id, label: role.name }));
  const expiryOptions = TOKEN_EXPIRY_OPTIONS.map((option) => ({
    value: option,
    label:
      option === 'never' ? t('apiTokens.expiryNever') : t('apiTokens.expiryDays', { count: Number(option) }),
  }));
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      title={t('apiTokens.createTitle')}
      dirty={form.formState.isDirty}
      pending={createToken.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormTextField control={form.control} name="name" label={t('apiTokens.name')} autoComplete="off" />
      <FormSelectField
        control={form.control}
        name="roleId"
        label={t('apiTokens.role')}
        options={roleOptions}
      />
      <FormSelectField
        control={form.control}
        name="expiry"
        label={t('apiTokens.expiry')}
        options={expiryOptions}
      />
      <FormError error={createToken.error ?? roles.error} />
    </FormSheet>
  );
};
