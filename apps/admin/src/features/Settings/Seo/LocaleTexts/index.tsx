import type { Locale } from '@shapio/client';
import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { Panel } from '@/components/Panel';
import { FieldGroup } from '@/components/ui/field';
import { LocaleSelect } from '@/features/Content/LocaleSelect';
import type { SeoSettingsValues } from '../helpers';

type LocaleTextsProps = {
  control: Control<SeoSettingsValues>;
  locales: readonly Locale[];
  locale: string;
  onLocaleChange: (code: string) => void;
};

/** Site name, title template and description for one locale at a time; empty ones follow the fallbacks. */
export const LocaleTexts = ({ control, locales, locale, onLocaleChange }: LocaleTextsProps) => {
  const { t } = useTranslation();
  return (
    <Panel
      title={t('seo.settings.textsTitle')}
      titleAs="h2"
      actions={
        locales.length > 1 ? (
          <LocaleSelect locales={locales} value={locale} onChange={onLocaleChange} size="sm" />
        ) : null
      }
    >
      <FieldGroup key={locale} className="max-w-xl">
        <FormTextField
          control={control}
          name={`locales.${locale}.siteName`}
          label={t('seo.settings.siteName')}
          hint={t('seo.settings.siteNameHint')}
        />
        <FormTextField
          control={control}
          name={`locales.${locale}.titleTemplate`}
          label={t('seo.settings.titleTemplate')}
          hint={t('seo.settings.titleTemplateHint')}
          placeholder={t('seo.settings.titleTemplatePlaceholder')}
        />
        <FormTextareaField
          control={control}
          name={`locales.${locale}.description`}
          label={t('seo.settings.description')}
          hint={t('seo.settings.descriptionHint')}
          rows={3}
        />
      </FieldGroup>
    </Panel>
  );
};
