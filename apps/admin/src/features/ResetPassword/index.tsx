import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { TextLink } from '@/components/TextLink';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup } from '@/components/ui/field';
import { useResetPasswordForm } from './hooks/useResetPasswordForm';

export const ResetPassword = () => {
  const { t } = useTranslation();
  const { form, onSubmit, confirmReset, hasToken } = useResetPasswordForm();
  if (!hasToken) {
    return (
      <AuthLayout title={t('resetPassword.title')}>
        <div className="flex flex-col gap-6">
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t('resetPassword.missingToken')}</AlertDescription>
          </Alert>
          <TextLink to="/forgot-password" className="self-start text-sm">
            {t('resetPassword.requestNew')}
          </TextLink>
        </div>
      </AuthLayout>
    );
  }
  if (confirmReset.isSuccess) {
    return (
      <AuthLayout title={t('resetPassword.doneTitle')}>
        <div className="flex flex-col gap-6">
          <p role="status" className="text-sm text-muted-foreground">
            {t('resetPassword.doneDescription')}
          </p>
          <TextLink to="/login" className="self-start text-sm">
            {t('auth.backToLogin')}
          </TextLink>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('resetPassword.title')} description={t('resetPassword.description')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="password"
            label={t('auth.newPassword')}
            description={t('auth.passwordHint')}
            type="password"
            autoComplete="new-password"
            autoFocus
          />
          <FormTextField
            control={form.control}
            name="confirmPassword"
            label={t('auth.confirmPassword')}
            type="password"
            autoComplete="new-password"
          />
          <FormError error={confirmReset.error} />
          <SubmitButton
            pending={confirmReset.isPending}
            pendingLabel={t('resetPassword.submitting')}
            size="lg"
            className="w-full"
          >
            {t('resetPassword.submit')}
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
};
