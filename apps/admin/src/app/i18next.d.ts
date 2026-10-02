import 'i18next';
import type en from '@/locales/en/translation.json';

// Translation keys are type-checked: `t('missing.key')` fails typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
