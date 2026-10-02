import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { LoadingState } from '@/components/LoadingState';
import { SubmitButton } from '@/components/SubmitButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup } from '@/components/ui/field';
import { useAcceptInvitationForm } from './hooks/useAcceptInvitationForm';

export const AcceptInvitation = () => {
  const { t } = useTranslation();
  const { form, onSubmit, accept, inspection, hasToken } = useAcceptInvitationForm();
  if (!hasToken) {
    return (
      <AuthLayout title={t('acceptInvitation.title')}>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t('acceptInvitation.missingToken')}</AlertDescription>
        </Alert>
      </AuthLayout>
    );
  }
  if (inspection.isPending) {
    return (
      <AuthLayout title={t('acceptInvitation.title')}>
        <LoadingState rows={3} />
      </AuthLayout>
    );
  }
  if (inspection.isError) {
    return (
      <AuthLayout title={t('acceptInvitation.title')}>
        <FormError error={inspection.error} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title={t('acceptInvitation.title')}
      description={t('acceptInvitation.joiningAs', { email: inspection.data.email })}
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="name"
            label={t('auth.name')}
            autoComplete="name"
            autoFocus
          />
          <FormTextField
            control={form.control}
            name="password"
            label={t('auth.password')}
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
          <FormError error={accept.error} />
          <SubmitButton
            pending={accept.isPending}
            pendingLabel={t('acceptInvitation.submitting')}
            size="lg"
            className="w-full"
          >
            {t('acceptInvitation.submit')}
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
};
