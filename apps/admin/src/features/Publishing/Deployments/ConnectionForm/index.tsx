import { DEPLOYMENT_PROVIDERS, type DeploymentSecretState } from '@shapio/client';
import { useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import { FormSelectField } from '@/components/FormSelectField';
import { FormSwitchField } from '@/components/FormSwitchField';
import { FormTextField } from '@/components/FormTextField';
import { PROVIDER_LABELS, TRIGGER_POLICY_LABELS } from '../../constants';
import {
  triggerOptionsFor,
  type ConnectionFormMode,
  type ConnectionFormValues,
} from '../helpers/connectionForm';
import { useDeliveryRoleOptions } from '../hooks/useDeliveryRoleOptions';
import { ProviderFields } from '../ProviderFields';

type ConnectionFormProps = {
  control: Control<ConnectionFormValues>;
  mode: ConnectionFormMode;
  storedSecrets?: DeploymentSecretState;
  /** The server can't read the stored secrets: they are entered again (or generated). */
  secretsUnreadable?: boolean;
};

/** A deployment connection's fields: provider (fixed once created), its settings and secrets, and policy. */
export const ConnectionForm = ({
  control,
  mode,
  storedSecrets,
  secretsUnreadable = false,
}: ConnectionFormProps) => {
  const { t } = useTranslation();
  const provider = useWatch({ control, name: 'provider' });
  const deliveryRoleOptions = useDeliveryRoleOptions();
  return (
    <>
      <FormTextField
        control={control}
        name="name"
        label={t('publishing.deployments.name')}
        autoComplete="off"
      />
      {mode === 'create' ? (
        <FormSelectField
          control={control}
          name="provider"
          label={t('publishing.deployments.provider')}
          options={DEPLOYMENT_PROVIDERS.map((value) => ({ value, label: t(PROVIDER_LABELS[value]) }))}
        />
      ) : null}
      <ProviderFields control={control} storedSecrets={storedSecrets} secretsUnreadable={secretsUnreadable} />
      <FormTextField
        control={control}
        name="previewUrlTemplate"
        label={t('publishing.deployments.previewUrlTemplate')}
        hint={t('publishing.deployments.previewUrlTemplateHint')}
        placeholder={t('publishing.deployments.previewUrlTemplatePlaceholder')}
        autoComplete="off"
        spellCheck={false}
      />
      <FormSelectField
        control={control}
        name="deliveryRoleId"
        label={t('publishing.deployments.deliveryRole')}
        hint={t('publishing.deployments.deliveryRoleHint')}
        options={deliveryRoleOptions}
      />
      <FormCheckboxGroup
        control={control}
        name="triggerPolicy"
        legend={t('publishing.deployments.triggerPolicy')}
        options={triggerOptionsFor(provider).map((value) => ({
          value,
          label: t(TRIGGER_POLICY_LABELS[value]),
        }))}
      />
      <FormTextField
        control={control}
        name="debounceSeconds"
        type="number"
        inputMode="numeric"
        min={0}
        label={t('publishing.deployments.debounceSeconds')}
        hint={t('publishing.deployments.debounceSecondsHint')}
        className="w-32"
      />
      <FormSwitchField control={control} name="enabled" label={t('publishing.deployments.enabled')} />
      <FormSwitchField
        control={control}
        name="allowPrivateNetwork"
        label={t('publishing.fields.allowPrivateNetwork')}
        hint={t('publishing.fields.allowPrivateNetworkHint')}
      />
    </>
  );
};
