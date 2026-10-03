import type { CreatedApiToken } from '@shapio/client';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { useRoles } from '@/api/roles';
import { FormError } from '@/components/FormError';
import { FormRadioGroup } from '@/components/FormRadioGroup';
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
  const { data: me } = useMe();
  const mayCreateNetwork = me?.networkPermissions.includes('users.manage') ?? false;
  const canChooseNetwork = (roleId: string) =>
    mayCreateNetwork && roles.data?.find((role) => role.id === roleId)?.kind === 'admin';
  const { form, onSubmit, createToken } = useCreateTokenForm(open, onCreated, canChooseNetwork);
  const roleId = useWatch({ control: form.control, name: 'roleId' });
  const scopeOptions = [
    {
      value: 'site',
      label: t('apiTokens.scopeSite', { name: me?.site.name ?? '' }),
      description: t('apiTokens.scopeSiteDescription'),
    },
    {
      value: 'network',
      label: t('apiTokens.scopeNetwork'),
      description: t('apiTokens.scopeNetworkDescription'),
    },
  ];
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
      {canChooseNetwork(roleId) ? (
        <FormRadioGroup
          control={form.control}
          name="scope"
          legend={t('apiTokens.scope')}
          options={scopeOptions}
        />
      ) : null}
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
