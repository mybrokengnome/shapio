import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSchemaVersion } from '@/api/schema';
import { FormTextField } from '@/components/FormTextField';
import { Button } from '@/components/ui/button';

type SchemaVersionFieldProps<TValues extends FieldValues> = {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  /** Fills the field with the current schema version. */
  onPinCurrent: (version: number) => void;
};

/**
 * The schema version a token is pinned to: empty for always the current schema, a number to pin. What
 * pinning does sits behind the label's info icon; the quick action pins to the current version.
 */
export const SchemaVersionField = <TValues extends FieldValues>({
  control,
  name,
  onPinCurrent,
}: SchemaVersionFieldProps<TValues>) => {
  const { t } = useTranslation();
  const { data: currentVersion } = useSchemaVersion();
  return (
    <FormTextField
      control={control}
      name={name}
      label={t('apiTokens.schemaVersion')}
      hint={t('apiTokens.schemaVersionHint')}
      placeholder={t('apiTokens.schemaVersionPlaceholder')}
      inputMode="numeric"
      autoComplete="off"
      extra={
        // No schema change yet (version 0): there is nothing to pin to.
        currentVersion !== undefined && currentVersion > 0 ? (
          // The field stretches its direct children; the wrapper keeps the button at its own width.
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => onPinCurrent(currentVersion)}>
              {t('apiTokens.pinCurrent', { version: currentVersion })}
            </Button>
          </div>
        ) : null
      }
    />
  );
};
