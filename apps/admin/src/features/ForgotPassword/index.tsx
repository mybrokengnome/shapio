import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { TextLink } from '@/components/TextLink';
import { FieldGroup } from '@/components/ui/field';
import { useForgotPasswordForm } from './hooks/useForgotPasswordForm';

export const ForgotPassword = () => {
  const { t } = useTranslation();
  const { form, onSubmit, requestReset, sentTo } = useForgotPasswordForm();
  if (sentTo !== undefined) {
    return (
      <AuthLayout title={t('forgotPassword.sentTitle')}>
        <div className="flex flex-col gap-6">
          <p role="status" className="text-sm text-muted-foreground">
            {t('forgotPassword.sentDescription', { email: sentTo })}
          </p>
          <TextLink to="/login" className="self-start text-sm">
            {t('auth.backToLogin')}
          </TextLink>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('forgotPassword.title')} description={t('forgotPassword.description')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="email"
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            autoFocus
          />
          <FormError error={requestReset.error} />
          <SubmitButton
            pending={requestReset.isPending}
            pendingLabel={t('forgotPassword.submitting')}
            size="lg"
            className="w-full"
          >
            {t('forgotPassword.submit')}
          </SubmitButton>
          <TextLink to="/login" className="self-center text-sm">
            {t('auth.backToLogin')}
          </TextLink>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
};
