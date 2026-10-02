import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/AuthLayout';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { useSetupFormAndTokenRequirement } from './hooks/useSetupFormAndTokenRequirement';

export const Setup = () => {
  const { t } = useTranslation();
  const { form, onSubmit, setup, requiresToken } = useSetupFormAndTokenRequirement();
  const { control } = form;
  return (
    <AuthLayout title={t('setup.title')} description={t('setup.description')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <FieldGroup>
          {requiresToken && (
            <FormTextField
              control={control}
              name="token"
              label={t('setup.token')}
              description={t('setup.tokenHint')}
              hint={t('setup.tokenMore')}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
          <FormTextField control={control} name="name" label={t('auth.name')} autoComplete="name" />
          <FormTextField
            control={control}
            name="email"
            label={t('auth.email')}
            type="email"
            autoComplete="email"
          />
          <FormTextField
            control={control}
            name="password"
            label={t('auth.password')}
            description={t('auth.passwordHint')}
            type="password"
            autoComplete="new-password"
          />
          <FormTextField
            control={control}
            name="confirmPassword"
            label={t('auth.confirmPassword')}
            type="password"
            autoComplete="new-password"
          />
          <FormError error={setup.error} />
          <SubmitButton
            pending={setup.isPending}
            pendingLabel={t('setup.submitting')}
            size="lg"
            className="w-full"
          >
            {t('setup.submit')}
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
};
