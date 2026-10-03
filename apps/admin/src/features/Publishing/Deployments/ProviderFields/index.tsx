import type { DeploymentSecretState } from '@shapio/client';
import { useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormSelectField } from '@/components/FormSelectField';
import { FormTextField } from '@/components/FormTextField';
import { GITHUB_MODES, PROVIDER_FIELDS, type ConnectionFormValues } from '../helpers/connectionForm';
import {
  GITHUB_MODE_LABELS,
  secretHintFor,
  SECRET_LABELS,
  SETTING_HINTS,
  SETTING_LABELS,
} from '../helpers/labels';
import { SecretField } from '../SecretField';

type ProviderFieldsProps = {
  control: Control<ConnectionFormValues>;
  /** Which secrets the server holds (edit); undefined when creating. */
  storedSecrets: DeploymentSecretState | undefined;
};

/** The chosen provider's settings and secrets. */
export const ProviderFields = ({ control, storedSecrets }: ProviderFieldsProps) => {
  const { t } = useTranslation();
  const provider = useWatch({ control, name: 'provider' });
  const fields = PROVIDER_FIELDS[provider];
  return (
    <>
      {fields.settings.map((name) => (
        <FormTextField
          key={name}
          control={control}
          name={`settings.${name}`}
          label={t(SETTING_LABELS[name])}
          hint={name in SETTING_HINTS ? t(SETTING_HINTS[name as keyof typeof SETTING_HINTS]) : undefined}
          type={name === 'url' ? 'url' : 'text'}
          autoComplete="off"
          spellCheck={false}
        />
      ))}
      {provider === 'github' ? (
        <FormSelectField
          control={control}
          name="settings.mode"
          label={t(SETTING_LABELS.mode)}
          options={GITHUB_MODES.map((mode) => ({ value: mode, label: t(GITHUB_MODE_LABELS[mode]) }))}
        />
      ) : null}
      {fields.secrets.map((secret) => (
        <SecretField
          key={`${provider}-${secret.name}`}
          control={control}
          name={secret.name}
          label={t(SECRET_LABELS[secret.name])}
          hint={t(secretHintFor(provider, secret.name))}
          stored={storedSecrets?.[secret.name]?.set ?? false}
          envVar={storedSecrets?.[secret.name]?.envVar ?? null}
        />
      ))}
    </>
  );
};
