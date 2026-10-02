import type { EntryLocaleState, Locale } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { EntryStatusChip } from '../../EntryStatusChip';

type LocaleStatusListProps = {
  locales: readonly Locale[];
  states: readonly EntryLocaleState[];
  current: string;
};

/** Every locale's status for this entry (publishing is per locale, so each has its own). */
export const LocaleStatusList = ({ locales, states, current }: LocaleStatusListProps) => {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('content.locales.statuses')} className="space-y-2">
      {locales.map((locale) => {
        const state = states.find((item) => item.locale === locale.code);
        return (
          <li key={locale.code} className="flex min-h-5 items-center justify-between gap-2 text-sm">
            <span className={cn('min-w-0 truncate', locale.code === current && 'font-semibold')}>
              {locale.label} <span className="font-mono text-xs text-muted-foreground">{locale.code}</span>
            </span>
            {state ? (
              <EntryStatusChip status={state.status} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">{t('content.locales.notCreated')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
};
