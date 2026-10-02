import type { AdminEntryListItem, EntryStatus } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { ENTRY_STATUS_LABEL_KEYS } from '../../helpers/entryStatus';
import { MAX_ROW_LOCALES } from '../constants';

const FLAG_CLASSES = {
  draft: 'bg-muted text-muted-foreground',
  modified: 'bg-warning-muted text-warning',
  published: 'bg-success-muted text-success',
} as const satisfies Record<EntryStatus, string>;

type LocaleFlagsProps = {
  item: Pick<AdminEntryListItem, 'id' | 'locale' | 'status' | 'locales'>;
  /** The locale the list is read in (outlined). */
  current: string;
  labelOf: (code: string) => string;
};

/**
 * The locales an entry has, each tinted by its state (published, changed, draft) and named with it for
 * assistive technology. The list's locale is outlined; a row read from a fallback locale shows that one.
 */
export const LocaleFlags = ({ item, current, labelOf }: LocaleFlagsProps) => {
  const { t } = useTranslation();
  const locales = item.locales ?? [{ locale: item.locale, status: item.status }];
  const shown = locales.slice(0, MAX_ROW_LOCALES);
  return (
    <ul aria-label={t('place.list.localesOf')} className="flex items-center gap-1">
      {shown.map(({ locale, status }) => {
        const description = t('place.list.localeState', {
          locale: labelOf(locale),
          status: t(ENTRY_STATUS_LABEL_KEYS[status]),
        });
        return (
          <li
            key={locale}
            title={description}
            className={cn(
              'inline-flex h-5 items-center rounded-full px-1.5 font-mono text-2xs font-semibold',
              FLAG_CLASSES[status],
              locale === current && 'ring-1 ring-input',
            )}
          >
            <span aria-hidden="true">{locale}</span>
            <span className="sr-only">{description}</span>
          </li>
        );
      })}
      {locales.length > shown.length ? (
        <li className="text-2xs font-semibold text-muted-foreground">+{locales.length - shown.length}</li>
      ) : null}
    </ul>
  );
};
