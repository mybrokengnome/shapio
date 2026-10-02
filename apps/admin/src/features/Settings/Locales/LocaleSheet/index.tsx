import type { Locale } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { FallbackChain } from '../FallbackChain';
import { useLocaleForm } from '../hooks/useLocaleForm';

type LocaleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this locale; add a new one when undefined. */
  locale: Locale | undefined;
  locales: readonly Locale[];
};

export const LocaleSheet = ({ open, onOpenChange, locale, locales }: LocaleSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, pending, error } = useLocaleForm(open, locale, () => onOpenChange(false));
  const code = form.watch('code');
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={locale ? t('locales.editTitle', { label: locale.label }) : t('locales.addTitle')}
      dirty={form.formState.isDirty}
      pending={pending}
      submitLabel={locale ? t('common.saveChanges') : t('locales.add')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormTextField
        control={form.control}
        name="code"
        label={t('locales.code')}
        hint={t('locales.codeHint')}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        disabled={locale !== undefined}
      />
      <FormTextField control={form.control} name="label" label={t('locales.label')} autoComplete="off" />
      <FallbackChain control={form.control} locales={locales} code={code} />
      <FormError error={error} />
    </FormSheet>
  );
};
