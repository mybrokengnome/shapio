import type { ApiToken } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { useEditTokenForm } from '../hooks/useEditTokenForm';
import { SchemaVersionField } from '../SchemaVersionField';

type EditSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The token being edited (kept while the sheet closes, so its title doesn't flicker). */
  token: ApiToken | undefined;
  onSaved: (saved: ApiToken) => void;
};

/** Edits a token's schema version pin; its name, role and expiry are fixed once created. */
export const EditSheet = ({ open, onOpenChange, token, onSaved }: EditSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, updateToken, pinCurrent } = useEditTokenForm(open, token, onSaved);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('apiTokens.editTitle', { name: token?.name ?? '' })}
      dirty={form.formState.isDirty}
      pending={updateToken.isPending}
      submitLabel={t('common.saveChanges')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <SchemaVersionField control={form.control} name="pinnedSchemaVersion" onPinCurrent={pinCurrent} />
      <FormError error={updateToken.error} />
    </FormSheet>
  );
};
