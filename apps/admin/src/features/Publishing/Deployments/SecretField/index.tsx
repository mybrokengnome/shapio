import { useState } from 'react';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import { HintedLabel } from '@/components/HintedLabel';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describedBy } from '@/helpers/describedBy';
import type { ConnectionFormValues, SecretName } from '../helpers/connectionForm';

type SecretFieldProps = {
  control: Control<ConnectionFormValues>;
  name: SecretName;
  label: string;
  /** What the secret is; shown behind the label's info icon with how to keep it in the environment. */
  hint: string;
  /** A value is stored on the server: show "Stored" with a Replace action instead of an empty input. */
  stored: boolean;
  /** The secret is read from this server environment variable (`${ENV:NAME}`). */
  envVar: string | null;
};

/** A write-only secret: never prefilled; an empty value keeps the stored one. */
export const SecretField = ({ control, name, label, hint, stored, envVar }: SecretFieldProps) => {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ control, name: `secrets.${name}` });
  const [replacing, setReplacing] = useState(false);
  const id = `field-secrets-${name}`;
  const hintId = `${id}-hint`;
  const errorId = fieldState.error ? `${id}-error` : undefined;
  const fullHint = `${hint} ${t('publishing.deployments.secretEnvHint')}`;
  if (stored && !replacing) {
    return (
      <Field>
        <HintedLabel htmlFor={`${id}-replace`} label={label} hint={fullHint} hintId={hintId} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone="success"
            label={
              envVar
                ? t('publishing.deployments.secretFromEnv', { name: envVar })
                : t('publishing.deployments.secretStored')
            }
          />
          <Button
            id={`${id}-replace`}
            type="button"
            variant="outline"
            size="sm"
            aria-describedby={hintId}
            onClick={() => setReplacing(true)}
          >
            {t('publishing.deployments.replaceSecret')}
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field data-invalid={fieldState.invalid || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={fullHint} hintId={hintId} />
      <div className="flex gap-2">
        <Input
          {...field}
          id={id}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          autoFocus={replacing}
          aria-invalid={fieldState.invalid || undefined}
          aria-describedby={describedBy(hintId, errorId)}
          className="font-mono text-sm"
        />
        {stored ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              field.onChange('');
              setReplacing(false);
            }}
          >
            {t('publishing.deployments.keepSecret')}
          </Button>
        ) : null}
      </div>
      <FormFieldError id={errorId} message={fieldState.error?.message} />
    </Field>
  );
};
