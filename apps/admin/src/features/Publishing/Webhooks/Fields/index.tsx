import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormSwitchField } from '@/components/FormSwitchField';
import { FormTextField } from '@/components/FormTextField';
import { EventsField } from '../EventsField';
import { MAX_ATTEMPTS_RANGE, type WebhookFormValues } from '../helpers';

type FieldsProps = { control: Control<WebhookFormValues> };

/** A webhook's settings, shared by the create sheet and the edit form. */
export const Fields = ({ control }: FieldsProps) => {
  const { t } = useTranslation();
  return (
    <>
      <FormTextField control={control} name="name" label={t('publishing.webhooks.name')} autoComplete="off" />
      <FormTextField
        control={control}
        name="url"
        type="url"
        label={t('publishing.webhooks.url')}
        placeholder={t('publishing.webhooks.urlPlaceholder')}
        autoComplete="off"
      />
      <EventsField control={control} />
      <FormTextField
        control={control}
        name="maxAttempts"
        type="number"
        inputMode="numeric"
        min={MAX_ATTEMPTS_RANGE.min}
        max={MAX_ATTEMPTS_RANGE.max}
        label={t('publishing.webhooks.maxAttempts')}
        hint={t('publishing.webhooks.maxAttemptsHint')}
        className="w-32"
      />
      <FormSwitchField control={control} name="enabled" label={t('publishing.webhooks.enabled')} />
      <FormSwitchField
        control={control}
        name="allowPrivateNetwork"
        label={t('publishing.fields.allowPrivateNetwork')}
        hint={t('publishing.fields.allowPrivateNetworkHint')}
      />
    </>
  );
};
