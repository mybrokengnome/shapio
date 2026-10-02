import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { useChangePasswordForm } from '../hooks/useChangePasswordForm';

type PasswordProps = { onDirtyChange: (dirty: boolean) => void };

export const Password = ({ onDirtyChange }: PasswordProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, changePassword } = useChangePasswordForm();
  const { isDirty } = form.formState;
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  return (
    <Panel title={t('profile.passwordTitle')} description={t('profile.passwordDescription')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="max-w-md">
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="currentPassword"
            label={t('profile.currentPassword')}
            type="password"
            autoComplete="current-password"
          />
          <FormTextField
            control={form.control}
            name="password"
            label={t('auth.newPassword')}
            description={t('auth.passwordHint')}
            type="password"
            autoComplete="new-password"
          />
          <FormTextField
            control={form.control}
            name="confirmPassword"
            label={t('auth.confirmPassword')}
            type="password"
            autoComplete="new-password"
          />
          <FormError error={changePassword.error} />
          <div>
            <SubmitButton pending={changePassword.isPending} pendingLabel={t('common.saving')}>
              {t('profile.changePassword')}
            </SubmitButton>
          </div>
        </FieldGroup>
      </form>
    </Panel>
  );
};
