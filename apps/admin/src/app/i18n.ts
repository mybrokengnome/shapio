import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en/translation.json';

export const DEFAULT_NAMESPACE = 'translation';

export const resources = { en: { [DEFAULT_NAMESPACE]: en } } as const;

/** English is the only hand-edited source; other languages are added as translated copies of it. */
export const initI18n = () =>
  i18next.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: DEFAULT_NAMESPACE,
    // React escapes rendered strings already.
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export { i18next };
