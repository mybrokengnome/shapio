import { PUBLICATION_ACTIONS } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useLocales } from '@/api/locales';
import { useDefinitions } from '@/api/schema';
import { PUBLICATION_ACTION_LABELS } from '../constants';
import { DEFAULT_LOCALE } from '../helpers/entryTarget';

/** Select options for the entry target fields: the models, the locales and the two actions. */
export const useEntryTargetOptions = () => {
  const { t } = useTranslation();
  const models = useDefinitions('model');
  const locales = useLocales();
  const modelOptions = (models.data ?? []).map(({ definition }) => ({
    value: definition.apiKey,
    label: `${definition.label} (${definition.apiKey})`,
  }));
  const localeOptions = [
    { value: DEFAULT_LOCALE, label: t('publishing.fields.defaultLocale') },
    ...(locales.data ?? []).map((locale) => ({
      value: locale.code,
      label: `${locale.label} (${locale.code})`,
    })),
  ];
  const actionOptions = PUBLICATION_ACTIONS.map((action) => ({
    value: action,
    label: t(PUBLICATION_ACTION_LABELS[action]),
  }));
  return { modelOptions, localeOptions, actionOptions };
};
