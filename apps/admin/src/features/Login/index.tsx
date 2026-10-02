import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { TextLink } from '@/components/TextLink';
import { FieldGroup } from '@/components/ui/field';
import { useLoginForm } from './hooks/useLoginForm';

export const Login = () => {
  const { t } = useTranslation();
  const { form, onSubmit, login } = useLoginForm();
  const { control } = form;
  return (
    <AuthLayout title={t('login.title')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <FieldGroup>
          <FormTextField
            control={control}
            name="email"
            label={t('auth.email')}
            type="email"
            autoComplete="username"
            autoFocus
          />
          <FormTextField
            control={control}
            name="password"
            label={t('auth.password')}
            type="password"
            autoComplete="current-password"
          />
          <FormError error={login.error} />
          <SubmitButton
            pending={login.isPending}
            pendingLabel={t('login.submitting')}
            size="lg"
            className="w-full"
          >
            {t('login.submit')}
          </SubmitButton>
          <TextLink to="/forgot-password" className="self-center text-sm">
            {t('login.forgotPassword')}
          </TextLink>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
};
