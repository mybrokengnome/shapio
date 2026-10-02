import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { HintedLabel } from '@/components/HintedLabel';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useProfileDetailsForm } from '../hooks/useProfileDetailsForm';

type DetailsProps = { onDirtyChange: (dirty: boolean) => void };

const EMAIL_ID = 'profile-email';
const EMAIL_HINT_ID = 'profile-email-hint';

export const Details = ({ onDirtyChange }: DetailsProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, updateProfile, email } = useProfileDetailsForm();
  const { isDirty } = form.formState;
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  return (
    <Panel title={t('profile.detailsTitle')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="max-w-md">
        <FieldGroup>
          <FormTextField control={form.control} name="name" label={t('auth.name')} autoComplete="name" />
          <Field>
            <HintedLabel
              htmlFor={EMAIL_ID}
              label={t('auth.email')}
              hint={t('profile.emailHint')}
              hintId={EMAIL_HINT_ID}
            />
            <Input id={EMAIL_ID} value={email} readOnly aria-describedby={EMAIL_HINT_ID} />
          </Field>
          <FormError error={updateProfile.error} />
          <div>
            <SubmitButton
              pending={updateProfile.isPending}
              pendingLabel={t('common.saving')}
              disabled={!isDirty}
            >
              {t('common.saveChanges')}
            </SubmitButton>
          </div>
        </FieldGroup>
      </form>
    </Panel>
  );
};
